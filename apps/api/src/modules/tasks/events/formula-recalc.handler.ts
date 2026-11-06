import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  CUSTOM_FIELD_EVENTS,
  customFieldDefinitionChangedPayloadSchema,
  TASK_EVENTS,
  taskUpdatedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { TaskFormulaService } from '../tasks/task-formula.service.js';
import { recalcSubtaskParents } from './formula-source.helpers.js';

/**
 * Пересчёт формул задач по зависимостям (#632, Р4/Р8). Триггеры:
 * - `task.updated` — значения атрибутов (`customFieldChanges`), системные
 *   поля и место задачи (родитель/проект/узел): пересчитываются ячейки
 *   задачи, зависимые от её значений и агрегаты старого/нового родителя;
 * - `custom_field.definition_changed` — значение компании (`company:<n>`)
 *   и удаление атрибута (`attr_number = N`, Р13) — массовый пересчёт.
 *
 * Глубина волны: источник-ячейка задаёт глубину (аккумулятор recalc_depth),
 * ручная правка — 1; превышение лимита ставит `cycle` и останавливает волну.
 * Порог sync/queue: ≤ 20 ячеек — синхронно в обработчике; больше — очередь
 * `formulas-recalc-tasks` (партии, at-least-once outbox).
 */
@Injectable()
export class TaskFormulaRecalcHandler {
  static readonly eventType = TASK_EVENTS.UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskFormulaRecalcHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const payload = parsed.data;
    const changes = payload.customFieldChanges ?? [];
    await this.txRunner.run(async (tx) => {
      const numbers: number[] = [];
      let sourceDepth = 0;
      for (const change of changes) {
        const number = await this.cells.numberByDefinitionId(change.fieldId, tx);
        if (number === null) continue;
        numbers.push(number);
        const depth = await this.cells.depthOf('task', payload.taskId, change.fieldId, tx);
        if (depth !== null) sourceDepth = Math.max(sourceDepth, depth);
      }
      this.logger.debug({ taskId: payload.taskId, numbers }, 'Пересчёт формул задачи');
      await this.formulas.recalcCells(
        tx,
        event.actorId ?? null,
        payload.taskId,
        numbers,
        sourceDepth + 1,
      );
      // Перепривязка (#632): состав подзадач сменился у старого и нового
      // родителя — их формулы-агрегаты пересчитываются (ручная правка — 1).
      // Место задачи (проект/узел) закрывает модуль проектов своими хостами.
      await recalcSubtaskParents(this.formulas, this.cells, tx, event.actorId ?? null, [
        payload.parentId,
        payload.previousParentId,
      ]);
    });
  }
}

/** Пересчёт по удалению атрибута и смене значения компании (Р13). */
@Injectable()
export class TaskFormulaDefinitionHandler {
  static readonly eventType = CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskFormulaDefinitionHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = customFieldDefinitionChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const payload = parsed.data;
    const companyChanged = payload.fields?.includes('companyValue') === true;
    const deleted = payload.change === 'deleted';
    if (!companyChanged && !deleted) return;
    const number = await this.cells.numberByDefinitionId(payload.definitionId);
    if (number === null) return;
    const cells = await this.cells.dependentCellsByAttrNumber(number);
    if (cells.length === 0) return;
    this.logger.debug({ number, cells: cells.length }, 'Массовый пересчёт формул задач');
    const hosts = [
      ...new Set(cells.filter((cell) => cell.hostKind === 'task').map((c) => c.hostId)),
    ];
    // Партии по 100 хостов в отдельной транзакции: массовый пересчёт не
    // должен упираться в таймаут одной tx; повтор события идемпотентен.
    for (let index = 0; index < hosts.length; index += 100) {
      const batch = hosts.slice(index, index + 100);
      await this.txRunner.run(async (tx) => {
        for (const hostId of batch) {
          await this.formulas.recalcCells(tx, event.actorId ?? null, hostId, [number], 1);
        }
      });
    }
  }
}
