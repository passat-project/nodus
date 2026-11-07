import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AuthUser,
  FormulaHostKind,
  FormulaMovePreviewResponse,
  FormulaNode,
  FormulaResponse,
} from '@nodus/contracts';
import { CUSTOM_FIELD_EVENTS } from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  FORMULA_CELLS,
  type FormulaCellRef,
  type FormulaCells,
  type FormulaRecalcOutcome,
} from '../../custom-fields/ports/formula-cells.port.js';
import {
  RECORD_VALUES_READER,
  type RecordValuesReader,
} from '../../custom-fields/ports/record-values.port.js';
import { actorRoles, audienceIds, taskAccess } from '../access/task-access.js';
import { TaskProjectRights } from '../access/task-project-rights.js';
import { TaskFieldsWriter } from './task-fields.writer.js';
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
    private readonly eventBus: EventBus,
    private readonly projectRights: TaskProjectRights,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    @Inject(RECORD_VALUES_READER) private readonly records: RecordValuesReader,
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
    await this.recalcOwn(tx, actorId, taskId, all, sourceDepth + 1);
  }

  /** Пересчёт ячеек задачи после изменения значений (Р4): общая точка. */
  async recalcCells(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    numbers: readonly number[],
    depth: number,
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
    if (all.length > 0) await this.recalcOwn(tx, actorId, taskId, all, depth);
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

  /** Пересчёт набора своих ячеек: значение → writer, ошибка → событие (O4). */
  private async recalcOwn(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    cells: readonly {
      cellId: string;
      hostKind: FormulaHostKind;
      hostId: string;
      fieldId: string;
    }[],
    depth: number,
  ): Promise<void> {
    const row0 = await this.liveRowOrNull(tx, taskId);
    if (!row0) return;
    // Замок строки до ячеек: тот же порядок, что у PATCH задачи (хост →
    // формула), иначе конкурентная правка значения даёт 40P01. Строка для
    // события перечитывается ПОД замком: снимок до лока нёс устаревшие
    // идентификационные поля (assigneeId аудитории).
    await this.repo.lock(tx, taskId);
    const row = await this.liveRowOrNull(tx, taskId);
    if (!row) return;
    const actor = { id: actorId ?? row.creatorId, permissions: [] as string[] };
    for (const cell of cells) {
      const outcome = await this.recalcOrNull(tx, cell, depth);
      if (!outcome || outcome.silent) continue;
      if (outcome.changed) {
        try {
          await this.writer.apply(
            tx,
            actor,
            row,
            { customFields: { [cell.fieldId]: outcome.value } },
            ['customFields'],
            { formulaWrite: true },
          );
        } catch (error) {
          // Сбой одной ячейки не валит партию (Р4): «ядовитая» ячейка не
          // должна превращать событие в вечный retry-loop диспетчера.
          this.log.warn(
            `Формула задачи ${taskId}/${cell.fieldId} не записана: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          continue;
        }
      }
      // formula_changed — только при смене наличия ошибки (O4): успешный
      // пересчёт значения уже уезжает событием хоста от writer'а.
      if (outcome.errorChanged) {
        await this.emitChanged(tx, actorId, taskId, cell.fieldId, outcome.error !== null);
      }
    }
  }

  /** Зависимые задачи модуля: их значения пишет tasks, не custom-fields (I3). */
  private async recalcForeign(
    tx: TransactionClient,
    actorId: string | null,
    cells: readonly {
      cellId: string;
      hostKind: FormulaHostKind;
      hostId: string;
      fieldId: string;
    }[],
    depth: number,
  ): Promise<void> {
    const seen = new Set<string>();
    // Все хосты-получатели блокируются в стабильном порядке (сортировка id):
    // два обработчика с разным порядком строк иначе дают 40P01.
    const hostIds = [...new Set(cells.map((cell) => cell.hostId))].sort();
    for (const hostId of hostIds) await this.repo.lock(tx, hostId);
    for (const cell of cells) {
      if (seen.has(cell.cellId)) continue;
      seen.add(cell.cellId);
      const row = await this.liveRowOrNull(tx, cell.hostId);
      if (!row) continue;
      const outcome = await this.recalcOrNull(tx, cell, depth);
      if (!outcome || outcome.silent) continue;
      const actor = { id: actorId ?? row.creatorId, permissions: [] as string[] };
      if (outcome.changed) {
        try {
          await this.writer.apply(
            tx,
            actor,
            row,
            { customFields: { [cell.fieldId]: outcome.value } },
            ['customFields'],
            { formulaWrite: true },
          );
        } catch (error) {
          this.log.warn(
            `Формула задачи ${cell.hostId}/${cell.fieldId} не записана: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          continue;
        }
      }
      if (outcome.errorChanged) {
        await this.emitChanged(tx, actorId, cell.hostId, cell.fieldId, outcome.error !== null);
      }
    }
  }

  /**
   * Пересчёт ячейки с изоляцией сбоя (Р4): падение чтения источника или
   * вычисления одной ячейки не валит транзакцию и не превращает событие в
   * вечный retry диспетчера — остальные ячейки партии пересчитываются.
   */
  private async recalcOrNull(
    tx: TransactionClient,
    cell: FormulaCellRef,
    depth: number,
  ): Promise<FormulaRecalcOutcome | null> {
    try {
      return await this.cells.recalc(tx, cell, depth);
    } catch (error) {
      this.log.warn(
        `Формула задачи ${cell.hostId}/${cell.fieldId} не пересчитана: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

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

  /** Живая задача или null: `findUniqueOrThrow` вне изоляции ячейки давал
   *  вечный retry события, если задачу удалили во время пересчёта. */
  private async liveRowOrNull(tx: TransactionClient, taskId: string) {
    try {
      return await this.repo.findWithParticipants(taskId, tx);
    } catch {
      this.log.warn(`Формулы задачи ${taskId}: запись исчезла до пересчёта`);
      return null;
    }
  }

  /** Адресное событие формулы (O4): без значений, только состояние ошибки. */
  private async emitChanged(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    fieldId: string,
    hasError: boolean,
  ): Promise<void> {
    const after = await this.liveRowOrNull(tx, taskId);
    // Задачу удалили, пока шёл пересчёт: адресата у события больше нет.
    if (!after) return;
    await this.eventBus.emit(
      tx,
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      {
        hostKind: 'task' satisfies FormulaHostKind,
        hostId: taskId,
        fieldId,
        hasError,
        // Актёр правки — в аудитории (как у task.updated): редактор-не-участник
        // иначе не узнаёт о собственной формуле (#632).
        audience: audienceIds(after, actorId ? [actorId] : []),
      },
      { actorId: actorId ?? undefined, aggregateType: 'task', aggregateId: taskId },
    );
  }
}
