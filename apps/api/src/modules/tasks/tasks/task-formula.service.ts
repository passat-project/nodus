import { Inject, Injectable } from '@nestjs/common';
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
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
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

  /** Снять формулу: последнее значение остаётся снимком (Р5). */
  async remove(user: AuthUser, taskId: string, fieldId: string): Promise<void> {
    await this.requireEdit(user, taskId);
    await this.txRunner.run(async (tx) => {
      await this.cells.remove(tx, { hostKind: 'task', hostId: taskId, fieldId });
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
    const subtree = (await this.query.subtreeIds(taskId)).slice(0, PREVIEW_TASKS_LIMIT);
    const visible = await this.query.visibleIdsAmong(user, subtree);
    const override = { taskNode: { [taskId]: nodeId } };
    return { changes: await this.cells.preview('task', visible, override) };
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
    const foreign = dependent.filter((cell) => cell.hostKind === 'task' && cell.hostId !== taskId);
    const linked = [
      ...(await this.cells.dependentCellsByDepKey(`system:task:${taskId}`, tx)),
      ...(await this.cells.dependentCellsByDepKey(`parent:task:${taskId}`, tx)),
    ].filter((cell) => cell.hostKind === 'task' && cell.hostId !== taskId);
    await this.recalcForeign(tx, actorId, [...foreign, ...linked], depth + 1);
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
    const row = await this.repo.findWithParticipants(taskId, tx);
    const actor = { id: actorId ?? row.creatorId, permissions: [] as string[] };
    for (const cell of cells) {
      const outcome = await this.cells.recalc(tx, cell, depth);
      if (outcome.silent) continue;
      if (outcome.changed) {
        await this.writer.apply(
          tx,
          actor,
          row,
          { customFields: { [cell.fieldId]: outcome.value } },
          ['customFields'],
          { formulaWrite: true },
        );
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
    for (const cell of cells) {
      if (seen.has(cell.cellId)) continue;
      seen.add(cell.cellId);
      const row = await this.repo.findWithParticipants(cell.hostId, tx);
      const outcome = await this.cells.recalc(tx, cell, depth);
      if (outcome.silent) continue;
      const actor = { id: actorId ?? row.creatorId, permissions: [] as string[] };
      if (outcome.changed) {
        await this.writer.apply(
          tx,
          actor,
          row,
          { customFields: { [cell.fieldId]: outcome.value } },
          ['customFields'],
          { formulaWrite: true },
        );
      }
      if (outcome.errorChanged) {
        await this.emitChanged(tx, actorId, cell.hostId, cell.fieldId, outcome.error !== null);
      }
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

  /** Адресное событие формулы (O4): без значений, только состояние ошибки. */
  private async emitChanged(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    fieldId: string,
    hasError: boolean,
  ): Promise<void> {
    const after = await this.repo.findWithParticipants(taskId, tx);
    await this.eventBus.emit(
      tx,
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      {
        hostKind: 'task' satisfies FormulaHostKind,
        hostId: taskId,
        fieldId,
        hasError,
        audience: audienceIds(after, []),
      },
      { actorId: actorId ?? undefined, aggregateType: 'task', aggregateId: taskId },
    );
  }
}
