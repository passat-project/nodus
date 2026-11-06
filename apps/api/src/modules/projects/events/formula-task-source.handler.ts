import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  TASK_EVENTS,
  taskCreatedPayloadSchema,
  taskDeletedPayloadSchema,
  taskUpdatedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { ProjectNodesRepository } from '../project-nodes.repository.js';
import { ProjectFormulaRecalcService } from '../project-formula-recalc.service.js';

/** Узлы, сгруппированные по проекту: писателю значения папки нужен проект. */
async function nodesByProject(
  nodes: ProjectNodesRepository,
  nodeIds: readonly string[],
  tx: TransactionClient,
): Promise<Map<string, string[]>> {
  const ids = [...new Set(nodeIds)];
  if (ids.length === 0) return new Map();
  const rows = await nodes.listByIds(ids, tx);
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const list = grouped.get(row.projectId) ?? [];
    list.push(row.id);
    grouped.set(row.projectId, list);
  }
  return grouped;
}

/**
 * Пересчёт формул ПРОЕКТОВ и ПАПОК по событиям задач (#632, Р4/Р8): задачи —
 * источник формул через атрибут-ссылку (`v:task:*`) и состав выборок папки
 * (`nodetasks:node:*`). Ячейки находят по зависимостям, значение пишет
 * владелец хоста (I3) — сами задачи здесь не пересчитываются и не пишутся.
 * Глубина волны: событие значения несёт глубину ячейки-источника (Р8),
 * структурное (место задачи) — 1 (ручная правка).
 */
@Injectable()
export class TaskUpdatedProjectFormulaHandler {
  static readonly eventType = TASK_EVENTS.UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    private readonly nodes: ProjectNodesRepository,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskUpdatedProjectFormulaHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const payload = parsed.data;
    const changes = payload.customFieldChanges ?? [];
    const moved = [payload.nodeId, payload.previousNodeId].filter(
      (id): id is string => typeof id === 'string',
    );
    await this.txRunner.run(async (tx) => {
      const actorId = event.actorId ?? null;
      // Место задачи сменилось: выборка «задачи папки» изменилась у старого
      // и нового узла — формулы обоих пересчитываются.
      for (const [projectId, nodeIds] of await nodesByProject(this.nodes, moved, tx)) {
        await this.formulas.recalcNodes(tx, actorId, projectId, nodeIds, 1);
      }
      // Системные поля задачи (название/срок/стадия) — источник `ref_field`
      // у формул проектов и папок (`system:task:<id>`), даже без атрибутов.
      const systemRefs = (
        await this.cells.dependentCellsByDepKey(`system:task:${payload.taskId}`, tx)
      ).filter((cell) => cell.hostKind === 'project' || cell.hostKind === 'node');
      // Смена проекта: ref-источник стал недоступен в старом проекте и
      // появился в новом — пересчитываем оба проекта и потребителей значений.
      if (
        payload.projectId !== undefined &&
        payload.previousProjectId !== undefined &&
        payload.projectId !== payload.previousProjectId
      ) {
        for (const projectId of new Set([payload.projectId, payload.previousProjectId])) {
          if (projectId) await this.formulas.recalcProjectCells(tx, actorId, projectId, [], 1);
        }
        const refs = (
          await this.cells.dependentCellsByDepPrefix(`v:task:${payload.taskId}:`, tx)
        ).filter((cell) => cell.hostKind === 'project' || cell.hostKind === 'node');
        await this.recalcHosts(tx, actorId, refs, 1);
      }
      if (changes.length === 0) {
        await this.recalcHosts(tx, actorId, systemRefs, 1);
        return;
      }
      const numbers: number[] = [];
      let depth = 0;
      for (const change of changes) {
        const number = await this.cells.numberByDefinitionId(change.fieldId, tx);
        if (number === null) continue;
        numbers.push(number);
        const cellDepth = await this.cells.depthOf('task', payload.taskId, change.fieldId, tx);
        if (cellDepth !== null) depth = Math.max(depth, cellDepth);
      }
      if (numbers.length > 0) {
        const refs = (
          await this.cells.dependentCellsByValues('task', payload.taskId, numbers, tx)
        ).filter((cell) => cell.hostKind === 'project' || cell.hostKind === 'node');
        await this.recalcHosts(tx, actorId, [...refs, ...systemRefs], depth + 1);
      } else {
        await this.recalcHosts(tx, actorId, systemRefs, 1);
      }
    });
  }

  /** Проекты и папки: их ячейки пишет их модуль (I3). */
  private async recalcHosts(
    tx: TransactionClient,
    actorId: string | null,
    refs: readonly { hostKind: string; hostId: string }[],
    depth: number,
  ): Promise<void> {
    if (refs.length === 0) return;
    const projects = [
      ...new Set(refs.filter((cell) => cell.hostKind === 'project').map((cell) => cell.hostId)),
    ];
    for (const projectId of projects) {
      await this.formulas.recalcProjectCells(tx, actorId, projectId, [], depth);
    }
    const nodeHosts = [
      ...new Set(refs.filter((cell) => cell.hostKind === 'node').map((cell) => cell.hostId)),
    ];
    for (const [projectId, nodeIds] of await nodesByProject(this.nodes, nodeHosts, tx)) {
      await this.formulas.recalcNodes(tx, actorId, projectId, nodeIds, depth);
    }
  }
}

/** Новая задача: состав выборки «задачи папки» вырос (`nodetasks:node:*`). */
@Injectable()
export class TaskCreatedProjectFormulaHandler {
  static readonly eventType = TASK_EVENTS.CREATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskCreatedProjectFormulaHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskCreatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { taskId, projectId, nodeId } = parsed.data;
    if (!projectId) return;
    this.logger.debug({ taskId, projectId, nodeId }, 'Пересчёт формул после создания задачи');
    await this.txRunner.run(async (tx) => {
      const actorId = event.actorId ?? null;
      // Задача в папке меняет только её выборку: проектные формулы задач не
      // агрегируют (ключей `nodetasks`/`subtasks` у проекта нет).
      if (nodeId) await this.formulas.recalcNodes(tx, actorId, projectId, [nodeId], 1);
      else await this.formulas.recalcProjectCells(tx, actorId, projectId, [], 1);
    });
  }
}

/** Удаление задачи: выборки папки и проекта похудели — формулы пересчитываются. */
@Injectable()
export class TaskDeletedProjectFormulaHandler {
  static readonly eventType = TASK_EVENTS.DELETED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskDeletedProjectFormulaHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = taskDeletedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { taskId, projectId, nodeId } = parsed.data;
    if (!projectId) return;
    this.logger.debug({ taskId, projectId, nodeId }, 'Пересчёт формул после удаления задачи');
    await this.txRunner.run(async (tx) => {
      const actorId = event.actorId ?? null;
      // Ячейки удалённой задачи чистит её модуль (I3): здесь только свои хосты.
      if (nodeId) await this.formulas.recalcNodes(tx, actorId, projectId, [nodeId], 1);
      await this.formulas.recalcProjectCells(tx, actorId, projectId, [], 1);
    });
  }
}

/**
 * Смена стадии/ответственного задачи (`task.stage_changed`/`task.assigned`):
 * `task.updated` при чистом переходе не эмитится, а системные поля задачи —
 * источник `ref_field` у формул проектов и папок (`system:task:<id>`).
 * Пересчитываются только свои хосты (I3).
 */
@Injectable()
class ProjectFormulaTaskSystemHandler {
  static readonly eventType = TASK_EVENTS.STAGE_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    private readonly nodes: ProjectNodesRepository,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectFormulaTaskSystemHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const taskId = event.payload.taskId;
    if (typeof taskId !== 'string') return;
    await this.txRunner.run(async (tx) => {
      const refs = (await this.cells.dependentCellsByDepKey(`system:task:${taskId}`, tx)).filter(
        (cell) => cell.hostKind === 'project' || cell.hostKind === 'node',
      );
      if (refs.length === 0) return;
      const projects = [
        ...new Set(refs.filter((cell) => cell.hostKind === 'project').map((cell) => cell.hostId)),
      ];
      for (const projectId of projects) {
        await this.formulas.recalcProjectCells(tx, event.actorId ?? null, projectId, [], 1);
      }
      const nodeHosts = [
        ...new Set(refs.filter((cell) => cell.hostKind === 'node').map((cell) => cell.hostId)),
      ];
      for (const [projectId, nodeIds] of await nodesByProject(this.nodes, nodeHosts, tx)) {
        await this.formulas.recalcNodes(tx, event.actorId ?? null, projectId, nodeIds, 1);
      }
    });
  }
}

export { ProjectFormulaTaskSystemHandler };
