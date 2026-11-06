import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, FormulaHostKind, FormulaNode, FormulaResponse } from '@nodus/contracts';
import { CUSTOM_FIELD_EVENTS } from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { actorRoles, audienceIds, taskAccess } from '../access/task-access.js';
import { TaskProjectRights } from '../access/task-project-rights.js';
import { TaskFieldsWriter } from './task-fields.writer.js';
import { TasksQueryService } from './tasks-query.service.js';
import { TasksRepository } from './tasks.repository.js';

/**
 * Формула ячейки задачи (#632, Р10): мутации живут у владельца хоста (I3).
 * Порт `FORMULA_CELLS` проверяет формулу и хранит её, значение пишет штатный
 * writer задачи (Р4) — событие `task.updated.customFieldChanges` уезжает
 * обычным путём, а `custom_field.formula_changed` (O4) — адресно участникам.
 * Право — canEdit задачи, как у правки полей.
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

  /** Пересчёт ячеек задачи после изменения значений (Р4): общая точка. */
  async recalcCells(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    numbers: readonly number[],
    depth: number,
  ): Promise<void> {
    const cells =
      numbers.length > 0
        ? await this.cells.dependentCellsByValues('task', taskId, numbers, tx)
        : [];
    const own = await this.cells.cellsForHost('task', taskId, tx);
    const seen = new Set(cells.map((cell) => cell.cellId));
    const all = [...cells, ...own.filter((cell) => !seen.has(cell.cellId))];
    if (all.length === 0) return;
    const row = await this.repo.findWithParticipants(taskId, tx);
    const actor = { id: actorId ?? row.creatorId, permissions: [] as string[] };
    for (const cell of all) {
      const outcome = await this.cells.recalc(tx, cell, depth);
      if (outcome.silent || !outcome.changed) continue;
      await this.writer.apply(
        tx,
        actor,
        row,
        { customFields: { [cell.fieldId]: outcome.value } },
        ['customFields'],
        { formulaWrite: true },
      );
      await this.emitChanged(tx, actorId, taskId, cell.fieldId, outcome.error !== null);
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
