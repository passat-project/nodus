import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  PROJECT_EVENTS,
  projectNodeCreatedPayloadSchema,
  projectNodeDeletedPayloadSchema,
  projectNodeKindChangedPayloadSchema,
  projectNodeMovedPayloadSchema,
  projectNodeUpdatedPayloadSchema,
  projectUpdatedPayloadSchema,
  type DomainEvent,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { ProjectNodesRepository } from '../project-nodes.repository.js';
import { ProjectFormulaRecalcService } from '../project-formula-recalc.service.js';

/** Номера атрибутов из ключей `cf.<uuid>` события хоста. */
async function numbersOf(
  cells: FormulaCells,
  hostKind: 'project' | 'node',
  hostId: string,
  fieldIds: readonly string[],
  tx: TransactionClient,
): Promise<{ numbers: number[]; depth: number }> {
  const numbers: number[] = [];
  let depth = 0;
  for (const fieldId of fieldIds) {
    const number = await cells.numberByDefinitionId(fieldId, tx);
    if (number === null) continue;
    numbers.push(number);
    const cellDepth = await cells.depthOf(hostKind, hostId, fieldId, tx);
    if (cellDepth !== null) depth = Math.max(depth, cellDepth);
  }
  return { numbers, depth };
}

/** Ключи `cf.<uuid>` из списка изменённых полей события (канон ADR-0029). */
function changedFieldIds(fields: readonly string[]): string[] {
  return fields
    .filter((field) => field.startsWith('cf.'))
    .map((field) => field.slice('cf.'.length));
}

/**
 * Пересчёт формул проекта по значениям (#632, Р4/Р8): `project.updated` несёт
 * изменённые ключи `cf.<id>` — пересчитываются ячейки проекта и формулы,
 * зависящие от его значений (`v:project:*`). Глубина волны — от ячейки-
 * источника (`recalc_depth`), ручная правка — 1; превышение лимита ставит
 * `cycle` и останавливает волну.
 */
@Injectable()
export class ProjectFormulaRecalcHandler {
  static readonly eventType = PROJECT_EVENTS.UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectFormulaRecalcHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const fieldIds = changedFieldIds(parsed.data.fields);
    const { projectId } = parsed.data;
    await this.txRunner.run(async (tx) => {
      const { numbers, depth } =
        fieldIds.length > 0
          ? await numbersOf(this.cells, 'project', projectId, fieldIds, tx)
          : { numbers: [], depth: 0 };
      this.logger.debug({ projectId, numbers }, 'Пересчёт формул проекта');
      // Свои ячейки проекта пересчитываются всегда: системные поля
      // (название/статус/даты/руководитель) меняются без атрибутов (Р4).
      await this.formulas.recalcProjectCells(
        tx,
        event.actorId ?? null,
        projectId,
        numbers,
        depth + 1,
      );
      const systemRefs = await this.cells.dependentCellsByDepKey(`system:project:${projectId}`, tx);
      const nodes = [
        ...new Set(systemRefs.filter((cell) => cell.hostKind === 'node').map((c) => c.hostId)),
      ];
      if (nodes.length > 0) {
        await this.formulas.recalcNodes(tx, event.actorId ?? null, projectId, nodes, depth + 1);
      }
    });
  }
}

/** Пересчёт формул папки по значениям её атрибутов (`project.node_updated`). */
@Injectable()
export class ProjectNodeFormulaRecalcHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectNodeFormulaRecalcHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectNodeUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const fieldIds = changedFieldIds(parsed.data.fields);
    const { projectId, nodeId } = parsed.data;
    await this.txRunner.run(async (tx) => {
      const { numbers, depth } =
        fieldIds.length > 0
          ? await numbersOf(this.cells, 'node', nodeId, fieldIds, tx)
          : { numbers: [], depth: 0 };
      this.logger.debug({ projectId, nodeId, numbers }, 'Пересчёт формул папки');
      // Свои ячейки папки — всегда (системные поля названия/вида, Р4).
      await this.formulas.recalcNodeCells(
        tx,
        event.actorId ?? null,
        projectId,
        nodeId,
        numbers,
        depth + 1,
      );
      const systemRefs = await this.cells.dependentCellsByDepKey(`system:node:${nodeId}`, tx);
      const nodes = [
        ...new Set(
          systemRefs
            .filter((cell) => cell.hostKind === 'node' && cell.hostId !== nodeId)
            .map((cell) => cell.hostId),
        ),
      ];
      if (nodes.length > 0) {
        await this.formulas.recalcNodes(tx, event.actorId ?? null, projectId, nodes, depth + 1);
      }
    });
  }
}

/**
 * Перенос папки (`project.node_moved`): цепочка предков меняется у поддерева,
 * прежний и новый родитель получают другую выборку — пересчитываются ячейки
 * поддерева и обоих родителей (Р4/§6).
 */
@Injectable()
export class ProjectStructureFormulaRecalcHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_MOVED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectStructureFormulaRecalcHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectNodeMovedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { projectId, nodeId, parentId, previousParentId } = parsed.data;
    const roots = [nodeId, parentId, previousParentId].filter(
      (id): id is string => id !== null && id !== undefined,
    );
    await this.txRunner.run(async (tx) => {
      this.logger.debug({ projectId, nodeId, roots }, 'Пересчёт формул после переноса папки');
      await this.formulas.recalcStructure(tx, event.actorId ?? null, projectId, roots, 1);
    });
  }
}

/**
 * Создание папки (`project.node_created`): срез дерева изменился — формулы
 * с зависимостью `tree:project:<id>` пересчитываются (Р4).
 */
@Injectable()
export class ProjectNodeCreatedFormulaHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_CREATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectNodeCreatedFormulaHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectNodeCreatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { projectId } = parsed.data;
    await this.txRunner.run(async (tx) => {
      const refs = await this.cells.dependentCellsByDepKey(`tree:project:${projectId}`, tx);
      const nodes = [
        ...new Set(refs.filter((cell) => cell.hostKind === 'node').map((cell) => cell.hostId)),
      ];
      if (nodes.length === 0) return;
      this.logger.debug({ projectId, nodes: nodes.length }, 'Формулы папок после создания');
      await this.formulas.recalcNodes(tx, event.actorId ?? null, projectId, nodes, 1);
    });
  }
}

/**
 * Удаление папки (`project.node_deleted`): ячейки удалённого хоста умирают
 * вместе с ним (Р4, «смерть связей»), формулы родителя и проекта
 * пересчитываются — выборки папки изменились.
 */
@Injectable()
export class ProjectNodeDeletedFormulaHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_DELETED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectNodeDeletedFormulaHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectNodeDeletedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const { projectId, nodeId, parentId } = parsed.data;
    await this.txRunner.run(async (tx) => {
      await this.cells.cleanupHost(tx, 'node', nodeId);
      const roots = parentId ? [parentId] : [];
      await this.formulas.recalcStructure(tx, event.actorId ?? null, projectId, roots, 1);
      // Потребители значений/системных полей удалённой папки по ссылке:
      // `v:node:<id>:*` и `system:node:<id>` — их формулы получают
      // `source_unavailable`, а не держат последнее значение (Р13).
      const refs = [
        ...(await this.cells.dependentCellsByDepPrefix(`v:node:${nodeId}:`, tx)),
        ...(await this.cells.dependentCellsByDepKey(`system:node:${nodeId}`, tx)),
      ];
      const dependents = [
        ...new Set(
          refs
            .filter((cell) => cell.hostKind === 'node' && cell.hostId !== nodeId)
            .map((cell) => cell.hostId),
        ),
      ];
      if (dependents.length > 0) {
        await this.formulas.recalcNodes(tx, event.actorId ?? null, projectId, dependents, 1);
      }
      await this.formulas.recalcProjectCells(tx, event.actorId ?? null, projectId, [], 1);
      this.logger.debug({ projectId, nodeId }, 'Формулы после удаления папки пересчитаны');
    });
  }
}

/**
 * Смена вида папки (`project.node_kind_changed`, каталожное): форма вида
 * задаёт привязки атрибутов — у папок этого вида меняется доступность
 * источников (`attribute_unavailable`). Пересчёт партиями по проектам
 * (≤100 папок в транзакции, Р4).
 */
@Injectable()
export class ProjectNodeKindFormulaHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_KIND_CHANGED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaRecalcService,
    private readonly nodes: ProjectNodesRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectNodeKindFormulaHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectNodeKindChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.change === 'created') return;
    const rows = await this.nodes.listByKind(parsed.data.kindId);
    if (rows.length === 0) return;
    const byProject = new Map<string, string[]>();
    for (const row of rows) {
      const list = byProject.get(row.projectId) ?? [];
      list.push(row.id);
      byProject.set(row.projectId, list);
    }
    for (const [projectId, nodeIds] of byProject) {
      for (let index = 0; index < nodeIds.length; index += 100) {
        const batch = nodeIds.slice(index, index + 100);
        await this.txRunner.run((tx) =>
          this.formulas.recalcNodes(tx, event.actorId ?? null, projectId, batch, 1),
        );
      }
    }
    this.logger.debug(
      { kindId: parsed.data.kindId, nodes: rows.length },
      'Формулы папок сменённого вида пересчитаны',
    );
  }
}
