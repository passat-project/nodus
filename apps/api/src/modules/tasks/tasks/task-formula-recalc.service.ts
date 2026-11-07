import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FormulaHostKind } from '@nodus/contracts';
import { CUSTOM_FIELD_EVENTS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  FORMULA_CELLS,
  type FormulaCellRef,
  type FormulaCells,
  type FormulaRecalcOutcome,
} from '../../custom-fields/ports/formula-cells.port.js';
import { audienceIds } from '../access/task-access.js';
import { TaskFieldsWriter } from './task-fields.writer.js';
import { TasksRepository } from './tasks.repository.js';

/**
 * Писатель пересчёта формул задач (#632, Р4/Р8): значение материализует
 * штатный writer задачи (`formulaWrite`), адресное `formula_changed` — при
 * смене наличия ошибки (O4). Вынесено из TaskFormulaService ради лимита
 * строк файла (I5); права и жизненный цикл формулы — в TaskFormulaService.
 */
@Injectable()
export class TaskFormulaRecalcService {
  private readonly log = new Logger(TaskFormulaRecalcService.name);

  constructor(
    private readonly repo: TasksRepository,
    private readonly writer: TaskFieldsWriter,
    private readonly eventBus: EventBus,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
  ) {}

  /** Пересчёт набора своих ячеек: значение → writer, ошибка → событие (O4). */
  async recalcOwn(
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
    opts: { includeActor?: boolean } = {},
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
            { formulaWrite: true, foreignWrite: opts.includeActor !== true },
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
        await this.emitChanged(tx, actorId, taskId, cell.fieldId, outcome.error !== null, {
          includeActor: opts.includeActor === true,
        });
      }
    }
  }

  /**
   * Зависимые задачи модуля: их значения пишет tasks, не custom-fields (I3).
   * Актёр-триггер в аудиторию чужих записей НЕ добавляется (security #632):
   * он может не видеть приёмник (конфиденциальная подзадача) — события
   * уходят только настоящей аудитории записи.
   */
  async recalcForeign(
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
            { formulaWrite: true, foreignWrite: true },
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
        await this.emitChanged(tx, actorId, cell.hostId, cell.fieldId, outcome.error !== null, {
          includeActor: false,
        });
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

  /** Адресное событие формулы (O4): без значений, только состояние ошибки.
   *  `includeActor=false` — каскадный пересчёт чужой записи: актёр-триггер
   *  в аудиторию не попадает (security #632). */
  async emitChanged(
    tx: TransactionClient,
    actorId: string | null,
    taskId: string,
    fieldId: string,
    hasError: boolean,
    opts: { includeActor?: boolean } = {},
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
        audience: audienceIds(
          after,
          opts.includeActor === false || actorId === null ? [] : [actorId],
        ),
      },
      { actorId: actorId ?? undefined, aggregateType: 'task', aggregateId: taskId },
    );
  }
}
