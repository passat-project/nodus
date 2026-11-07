import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  TASK_EVENTS,
  taskCreatedPayloadSchema,
  taskDeletedPayloadSchema,
  taskEventBaseSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { TaskFormulaService } from '../tasks/task-formula.service.js';
import {
  recalcNodeTaskConsumers,
  recalcSubtaskParents,
  recalcTaskHosts,
  taskHosts,
} from './formula-source.helpers.js';

/**
 * Пересчёт формул задач по событиям их собственного жизненного цикла (#632,
 * Р4/Р8), кроме `task.updated` (он у `TaskFormulaRecalcHandler`):
 * - `task.relation_changed` — выборки связанных (`rel:task:*`) сменились,
 *   событие приходит по ОБЕИМ сторонам связи;
 * - `task.created` — состав подзадач родителя вырос (своих ячеек у новой
 *   задачи нет);
 * - `task.deleted` — ячейки удалённого хоста умирают вместе с ним, агрегат
 *   родителя пересчитывается.
 * Пишутся только ячейки задач (I3): папки и проекты пересчитывает их модуль.
 */
@Injectable()
export class TaskRelationFormulaHandler {
  static readonly eventType = TASK_EVENTS.RELATION_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskRelationFormulaHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskEventBaseSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { taskId } = parsed.data;
    this.logger.debug({ taskId }, 'Пересчёт формул задачи после смены связей');
    await this.txRunner.run((tx) =>
      // Связь эмитится по ОБЕИМ сторонам с одним актёром: вторая может быть
      // ему невидима (конфиденциальная) — каскадный вход без актёра в
      // аудитории (security #632); свежесть своей стороны закрывает прямое
      // relation_changed своей аудитории и ответ мутации.
      this.formulas.recalcCells(tx, event.actorId ?? null, taskId, [], 1),
    );
  }
}

/** Новая подзадача: агрегаты родителя (`subtasks:task:*`) пересчитываются. */
@Injectable()
export class TaskCreatedFormulaSourceHandler {
  static readonly eventType = TASK_EVENTS.CREATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskCreatedFormulaSourceHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskCreatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { taskId, parentId, nodeId } = parsed.data;
    this.logger.debug({ taskId, parentId, nodeId }, 'Пересчёт формул после создания задачи');
    await this.txRunner.run(async (tx) => {
      await recalcSubtaskParents(this.formulas, this.cells, tx, event.actorId ?? null, [parentId]);
      // Задача вошла в выборку «задачи папки»: агрегаты соседей изменились.
      await recalcNodeTaskConsumers(this.formulas, this.cells, tx, event.actorId ?? null, [nodeId]);
    });
  }
}

/** Удаление задачи: ячейки хоста убираются, агрегаты родителя пересчитываются. */
@Injectable()
export class TaskDeletedFormulaSourceHandler {
  static readonly eventType = TASK_EVENTS.DELETED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskDeletedFormulaSourceHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskDeletedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { taskId, parentId, nodeId } = parsed.data;
    this.logger.debug({ taskId, parentId, nodeId }, 'Формулы после удаления задачи');
    await this.txRunner.run(async (tx) => {
      // «Смерть связей» (Р4): ячейки удалённой задачи живыми не остаются.
      await this.cells.cleanupHost(tx, 'task', taskId);
      // Потребители значений/системных полей удалённой задачи: источник
      // стал недоступен — их ячейки пересчитываются, а не висят протухшими
      // (префикс `v:task:<id>:` находит все номера одним запросом).
      const refs = [
        ...(await this.cells.dependentCellsByDepPrefix(`v:task:${taskId}:`, tx)),
        ...(await this.cells.dependentCellsByDepKey(`system:task:${taskId}`, tx)),
        ...(await this.cells.dependentCellsByDepKey(`parent:task:${taskId}`, tx)),
      ];
      await recalcTaskHosts(
        this.formulas,
        tx,
        event.actorId ?? null,
        taskHosts(refs).filter((hostId) => hostId !== taskId),
        1,
      );
      await recalcSubtaskParents(this.formulas, this.cells, tx, event.actorId ?? null, [parentId]);
      // Задача вышла из выборки «задачи папки»: агрегаты соседей изменились.
      await recalcNodeTaskConsumers(this.formulas, this.cells, tx, event.actorId ?? null, [nodeId]);
    });
  }
}

/**
 * Системные поля задачи, меняющиеся НЕ через `task.updated` (стадия,
 * ответственный): свои ячейки задачи и формулы-потребители её системных
 * полей (`system:task:*`) пересчитываются (Р4).
 */
@Injectable()
class TaskSystemFieldRunner {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskSystemFieldRunner.name);
  }

  async run(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const taskId = event.payload.taskId;
    if (typeof taskId !== 'string') return;
    await this.txRunner.run(async (tx) => {
      await this.formulas.recalcCells(tx, event.actorId ?? null, taskId, [], 1);
      const refs = await this.cells.dependentCellsByDepKey(`system:task:${taskId}`, tx);
      const hosts = taskHosts(refs).filter((hostId) => hostId !== taskId);
      await recalcTaskHosts(this.formulas, tx, event.actorId ?? null, hosts, 1);
    });
  }
}

export { TaskSystemFieldRunner };

@Injectable()
export class TaskStageFormulaHandler {
  static readonly eventType = TASK_EVENTS.STAGE_CHANGED;
  constructor(private readonly runner: TaskSystemFieldRunner) {}
  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.runner.run(event);
  }
}

@Injectable()
export class TaskAssignedFormulaHandler {
  static readonly eventType = TASK_EVENTS.ASSIGNED;
  constructor(private readonly runner: TaskSystemFieldRunner) {}
  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.runner.run(event);
  }
}

/**
 * Смена типа задачи (`task.type_changed`): у задачи меняется место (привязки
 * атрибутов), формулы могут стать `attribute_unavailable` или снова
 * доступными. Стадия при этом часто не меняется, поэтому `task.updated`
 * может не быть — пересчитываем свои ячейки явно.
 */
@Injectable()
export class TaskTypeFormulaHandler {
  static readonly eventType = TASK_EVENTS.TYPE_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
  ) {}

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskEventBaseSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { taskId } = parsed.data;
    await this.txRunner.run((tx) =>
      this.formulas.recalcCells(tx, event.actorId ?? null, taskId, [], 1),
    );
  }
}
