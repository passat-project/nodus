import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  PROJECT_EVENTS,
  projectNodeUpdatedPayloadSchema,
  projectUpdatedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { TaskFormulaService } from '../tasks/task-formula.service.js';
import {
  changedFieldIds,
  recalcTaskHosts,
  sourceNumbers,
  taskHosts,
} from './formula-source.helpers.js';

/**
 * Пересчёт формул ЗАДАЧ по событиям проектов (#632, Р4/Р8): значения проекта
 * и папок — источники формул задачи (`v:project:*`, `v:node:*`), структура
 * дерева — выборки папок и системных полей (`tree:project:*`). Ячейки задач
 * находят по зависимостям и пересчитывает владелец хоста (I3): проекты и
 * папки здесь не пишутся. Глубина волны — от ячейки-источника (аккумулятор
 * recalc_depth), у структурных событий — 1 (ручная правка).
 */
@Injectable()
export class TaskFormulaProjectSourceHandler {
  static readonly eventType = PROJECT_EVENTS.UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskFormulaProjectSourceHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { projectId } = parsed.data;
    const fieldIds = changedFieldIds(parsed.data.fields);
    await this.txRunner.run(async (tx) => {
      // Системные поля проекта (название/статус/даты/руководитель) меняются
      // и без атрибутов — ключ `system:project` покрывает их (Р4).
      const systemRefs = await this.cells.dependentCellsByDepKey(`system:project:${projectId}`, tx);
      const { numbers, depth } =
        fieldIds.length > 0
          ? await sourceNumbers(this.cells, 'project', projectId, fieldIds, tx)
          : { numbers: [], depth: 0 };
      const valueRefs =
        numbers.length > 0
          ? await this.cells.dependentCellsByValues('project', projectId, numbers, tx)
          : [];
      const hosts = taskHosts([...systemRefs, ...valueRefs]);
      if (hosts.length === 0) return;
      this.logger.debug(
        { projectId, hosts: hosts.length },
        'Пересчёт формул задач по значениям проекта',
      );
      await recalcTaskHosts(this.formulas, tx, event.actorId ?? null, hosts, depth + 1);
    });
  }
}

/** `project.node_updated`: значения папки сменились — формулы её задач-потребителей. */
@Injectable()
export class TaskFormulaNodeSourceHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskFormulaNodeSourceHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectNodeUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { projectId, nodeId } = parsed.data;
    const fieldIds = changedFieldIds(parsed.data.fields);
    await this.txRunner.run(async (tx) => {
      const systemRefs = await this.cells.dependentCellsByDepKey(`system:node:${nodeId}`, tx);
      const { numbers, depth } =
        fieldIds.length > 0
          ? await sourceNumbers(this.cells, 'node', nodeId, fieldIds, tx)
          : { numbers: [], depth: 0 };
      const valueRefs =
        numbers.length > 0
          ? await this.cells.dependentCellsByValues('node', nodeId, numbers, tx)
          : [];
      const hosts = taskHosts([...systemRefs, ...valueRefs]);
      if (hosts.length === 0) return;
      this.logger.debug(
        { projectId, nodeId, hosts: hosts.length },
        'Пересчёт формул задач по значениям папки',
      );
      await recalcTaskHosts(this.formulas, tx, event.actorId ?? null, hosts, depth + 1);
    });
  }
}

/**
 * Структура проекта сменилась (`project.node_created` / `node_moved` /
 * `node_deleted`): у задач-потребителей `tree:project:<id>` меняется выборка
 * папок и цепочка предков. Точный набор узлов не нужен — ключ дерева
 * покрывает поддерево и обоих родителей (Р4); глубина — 1.
 */
@Injectable()
class TaskFormulaTreeRunner {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: TaskFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskFormulaTreeRunner.name);
  }

  async run(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const projectId = event.payload.projectId;
    if (typeof projectId !== 'string') return;
    await this.txRunner.run(async (tx) => {
      const refs = await this.cells.dependentCellsByDepKey(`tree:project:${projectId}`, tx);
      const hosts = taskHosts(refs);
      if (hosts.length === 0) return;
      this.logger.debug(
        { projectId, hosts: hosts.length },
        'Пересчёт формул задач по структуре проекта',
      );
      await recalcTaskHosts(this.formulas, tx, event.actorId ?? null, hosts, 1);
    });
  }
}

export { TaskFormulaTreeRunner };

@Injectable()
export class TaskFormulaTreeCreatedHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_CREATED;
  constructor(private readonly runner: TaskFormulaTreeRunner) {}
  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.runner.run(event);
  }
}

@Injectable()
export class TaskFormulaTreeMovedHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_MOVED;
  constructor(private readonly runner: TaskFormulaTreeRunner) {}
  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.runner.run(event);
  }
}

@Injectable()
export class TaskFormulaTreeDeletedHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_DELETED;
  constructor(private readonly runner: TaskFormulaTreeRunner) {}
  handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    return this.runner.run(event);
  }
}
