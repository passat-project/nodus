import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AuthUser,
  FormulaMovePreviewResponse,
  FormulaNode,
  FormulaResponse,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  FORMULA_CELLS,
  type FormulaCellRef,
  type FormulaCells,
} from '../../custom-fields/ports/formula-cells.port.js';
import {
  RECORD_VALUES_READER,
  type RecordValuesReader,
} from '../../custom-fields/ports/record-values.port.js';
import { actorRoles, taskAccess } from '../access/task-access.js';
import { TaskProjectRights } from '../access/task-project-rights.js';
import { TaskFieldsWriter } from './task-fields.writer.js';
import { TaskFormulaRecalcService } from './task-formula-recalc.service.js';
import { TasksQueryService } from './tasks-query.service.js';
import { TasksRepository } from './tasks.repository.js';

/** Потолок поддерева в move-preview (#632): диалог подтверждения — про
 *  «что изменится», а не про пересчёт тысяч задач. */
const PREVIEW_TASKS_LIMIT = 100;

/** Потолок синхронного пересчёта в tx PATCH (#632): заодно и диспэтчер
 *  обработчика — массовый каскад не должен удлинять транзакцию пользователя. */
const SYNC_RECALC_LIMIT = 20;

/**
 * Формула ячейки задачи (#632, Р10): мутации живут у владельца хоста (I3).
 * Порт `FORMULA_CELLS` проверяет формулу и хранит её, значение пишет штатный
 * writer задачи (Р4) — событие `task.updated.customFieldChanges` уезжает
 * обычным путём, а `custom_field.formula_changed` (O4) — адресно участникам.
 * Право — canEdit задачи, как у правки полей. Dry-run переноса
 * (`movePreview`, Р10) — чтение: формулы считаются «как после переноса»
 * портом, в БД не пишется ничего.
 */
@Injectable()
export class TaskFormulaService {
  private readonly log = new Logger(TaskFormulaService.name);

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly query: TasksQueryService,
    private readonly repo: TasksRepository,
    private readonly writer: TaskFieldsWriter,
    private readonly projectRights: TaskProjectRights,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    @Inject(RECORD_VALUES_READER) private readonly records: RecordValuesReader,
    private readonly recalcWriter: TaskFormulaRecalcService,
  ) {}

  /** Эффективная формула ячейки для редактора: смотреть может любой зритель. */
  async read(user: AuthUser, taskId: string, fieldId: string): Promise<FormulaResponse> {
    await this.query.visibleRow(user, taskId);
    return this.cells.read('task', taskId, fieldId);
  }

  /** Поставить/заменить свою формулу: проверка → запись → значение. */
  async save(
    user: AuthUser,
    taskId: string,
    fieldId: string,
    ast: FormulaNode,
  ): Promise<FormulaResponse> {
    const row = await this.requireEdit(user, taskId);
    return this.txRunner.run(async (tx) => {
      // Порядок замков как у PATCH задачи: строка → ячейки. Иначе
      // параллельные «правка значения» и «поставить формулу» берут строки в
      // разном порядке и ловят 40P01 (как уже сделано у письма).
      await this.repo.lock(tx, taskId);
      const outcome = await this.cells.save(tx, {
        hostKind: 'task',
        hostId: taskId,
        fieldId,
        ast,
        actorId: user.id,
      });
      await this.writer.apply(
        tx,
        user,
        row,
        { customFields: { [fieldId]: outcome.value } },
        ['customFields'],
        { formulaWrite: true },
      );
      await this.emitChanged(tx, user.id, taskId, fieldId, outcome.error !== null);
      return { ast, origin: 'own' as const };
    });
  }

  /** Снять формулу (#660): вычисленное формулой значение очищается — ячейка
   *  пуста или под формулой типа/вида («снимок» больше не остаётся:
   *  иначе он подавлял бы формулу типа, а без неё висел бы значением
   *  без источника). */
  async remove(user: AuthUser, taskId: string, fieldId: string): Promise<void> {
    const row = await this.requireEdit(user, taskId);
    await this.txRunner.run(async (tx) => {
      await this.cells.remove(tx, { hostKind: 'task', hostId: taskId, fieldId });
      await this.writer.apply(
        tx,
        user,
        row,
        { customFields: { [fieldId]: null } },
        ['customFields'],
        { formulaWrite: true },
      );
      await this.emitChanged(tx, user.id, taskId, fieldId, false);
    });
  }

  /**
   * Dry-run переноса задачи в папку структуры (#632, Р10; `nodeId=null` —
   * вынос из папки): какие формульные значения изменятся. Ничего не пишет.
   *
   * Сравнивается ПОДДЕРЕВО задачи (≤ `PREVIEW_TASKS_LIMIT`): формула ребёнка
   * может читать родителя и его папку, поэтому смена места корня двигает и
   * значения потомков. Невидимые актору задачи в диалог не попадают (Р7) —
   * ни значения, ни подписи. Узел проверяется теми же правилами, что перенос:
   * существует и принадлежит проекту задачи, иначе 404 без оракула.
   */
  async movePreview(
    user: AuthUser,
    taskId: string,
    nodeId: string | null,
  ): Promise<FormulaMovePreviewResponse> {
    const row = await this.requireEdit(user, taskId);
    if (nodeId !== null) {
      const node = await this.records.record('node', nodeId);
      // Чужой/несуществующий узел неотличимы: перенос всё равно запрещён.
      if (!node || node.projectId !== row.projectId) {
        throw DomainException.notFound('Node not found', { nodeId });
      }
    }
    const allSubtree = await this.query.subtreeIds(taskId);
    const subtree = allSubtree.slice(0, PREVIEW_TASKS_LIMIT);
    const visible = await this.query.visibleIdsAmong(user, subtree);
    const override = { taskNode: { [taskId]: nodeId } };
    // Задача меняет папку — у СТАРОЙ и НОВОЙ папки меняется выборка «задачи
    // папки»: их формулы пересчитываются реальным переносом, значит и дифф
    // должен их показать (иначе окно обещает не то, что произойдёт).
    // Текущая папка тоже должна принадлежать проекту задачи: аномальный
    // nodeId из чужих данных не должен раскрывать имя/значения чужой папки.
    const currentNode = row.nodeId ? await this.records.record('node', row.nodeId) : null;
    const currentNodeId =
      row.nodeId && currentNode?.projectId === row.projectId ? row.nodeId : null;
    const nodeIds = [...new Set([currentNodeId, nodeId].filter((id): id is string => id !== null))];
    const [taskChanges, nodeChanges] = await Promise.all([
      this.cells.preview('task', visible, override),
      nodeIds.length > 0 ? this.cells.preview('node', nodeIds, override) : Promise.resolve([]),
    ]);
    return {
      changes: [...taskChanges, ...nodeChanges],
      ...(allSubtree.length > PREVIEW_TASKS_LIMIT ? { truncated: true } : {}),
    };
  }

  /**
   * Синхронный пересчёт СВОИХ ячеек задачи в транзакции PATCH (#632):
   * ответ мутации обязан нести свежие формульные значения — асинхронный
   * обработчик опаздывает на цикл диспетчера (outbox-поллинг), и карточка
   * автора «отстаёт на шаг» (правка N показывает результат правки N-1).
   * Пересчитываются только ячейки ЭТОЙ задачи; чужие хосты — диспетчеру
   * (их строки пишет их модуль, I3). Свыше `SYNC_RECALC_LIMIT` ячеек —
   * пропускаем: каскад догонит диспетчер, tx пользователя не удлиняем.
   */
  async recalcOwnAfterValuesChange(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    fieldIds: readonly string[],
  ): Promise<void> {
    const numbers: number[] = [];
    let sourceDepth = 0;
    for (const fieldId of fieldIds) {
      const number = await this.cells.numberByDefinitionId(fieldId, tx);
      if (number === null) continue;
      numbers.push(number);
      const depth = await this.cells.depthOf('task', taskId, fieldId, tx);
      if (depth !== null) sourceDepth = Math.max(sourceDepth, depth);
    }
    if (numbers.length === 0) return;
    const dependent = await this.cells.dependentCellsByValues('task', taskId, numbers, tx);
    const mine = dependent.filter((cell) => cell.hostKind === 'task' && cell.hostId === taskId);
    const own = await this.cells.cellsForHost('task', taskId, tx);
    const seen = new Set(mine.map((cell) => cell.cellId));
    const all = [...mine, ...own.filter((cell) => !seen.has(cell.cellId))];
    if (all.length === 0 || all.length > SYNC_RECALC_LIMIT) return;
    await this.recalcOwn(tx, actorId, taskId, all, sourceDepth + 1, {
      includeActor: true,
    });
  }

  /**
   * Пересчёт ячеек задачи после изменения значений (Р4): общая точка.
   * `includeActorForOwnHost` — только для входов «запись = та, что правил
   * актёр» (task.updated/связи своей записи, синхронный пересчёт PATCH):
   * каскадные входы (значения проекта/письма, чужие хосты, смена компании)
   * актёра-триггера в аудиторию чужих задач не добавляют (security #632).
   */
  async recalcCells(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    numbers: readonly number[],
    depth: number,
    opts: { includeActorForOwnHost?: boolean } = {},
  ): Promise<void> {
    // Свои ячейки (I3): значение пишется только в строку своего хоста.
    const dependent =
      numbers.length > 0
        ? await this.cells.dependentCellsByValues('task', taskId, numbers, tx)
        : [];
    const mine = dependent.filter((cell) => cell.hostKind === 'task' && cell.hostId === taskId);
    const own = await this.cells.cellsForHost('task', taskId, tx);
    const seen = new Set(mine.map((cell) => cell.cellId));
    const all = [...mine, ...own.filter((cell) => !seen.has(cell.cellId))];
    if (all.length > 0)
      await this.recalcOwn(tx, actorId, taskId, all, depth, {
        includeActor: opts.includeActorForOwnHost === true,
      });
    // Зависимые задачи ТОГО ЖЕ модуля (формула ребёнка «Родитель · Поле»,
    // системные поля родителя): их строки пишет tasks — I3 не нарушается.
    // Глубина та же, что у своих: обработчик следующего события сам добавит
    // шаг, иначе каскад растёт на +2 за хоп и ложно упирается в `cycle`.
    const foreign = dependent.filter((cell) => cell.hostKind === 'task' && cell.hostId !== taskId);
    const linked = [
      ...(await this.cells.dependentCellsByDepKey(`system:task:${taskId}`, tx)),
      ...(await this.cells.dependentCellsByDepKey(`parent:task:${taskId}`, tx)),
    ].filter((cell) => cell.hostKind === 'task' && cell.hostId !== taskId);
    await this.recalcForeign(tx, actorId, [...foreign, ...linked], depth);
  }

  /** Пересчёт своих ячеек — писатель пересчёта (I5). */
  private recalcOwn(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    cells: readonly FormulaCellRef[],
    depth: number,
    opts: { includeActor?: boolean } = {},
  ): Promise<void> {
    return this.recalcWriter.recalcOwn(tx, actorId, taskId, cells, depth, opts);
  }

  /** Зависимые задачи модуля — писатель пересчёта (I5). */
  private recalcForeign(
    tx: TransactionClient,
    actorId: string | null,
    cells: readonly FormulaCellRef[],
    depth: number,
  ): Promise<void> {
    return this.recalcWriter.recalcForeign(tx, actorId, cells, depth);
  }

  /** Адресное событие формулы (O4). */
  private emitChanged(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    fieldId: string,
    hasError: boolean,
  ): Promise<void> {
    return this.recalcWriter.emitChanged(tx, actorId, taskId, fieldId, hasError);
  }

  /** Право правки задачи (как у PATCH полей). */
  private async requireEdit(user: AuthUser, taskId: string) {
    const row = await this.query.visibleRow(user, taskId);
    const roles = await this.projectRights.supplement(
      actorRoles(row, user.id),
      user.id,
      row.projectId,
    );
    if (!taskAccess(roles, user.permissions).canEdit) {
      throw DomainException.forbidden('Task edit not allowed');
    }
    return row;
  }
}
