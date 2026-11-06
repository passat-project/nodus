import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  PROJECT_EVENTS,
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
import { ProjectFormulaService } from '../project-formula.service.js';

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
    private readonly formulas: ProjectFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectFormulaRecalcHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const fieldIds = changedFieldIds(parsed.data.fields);
    if (fieldIds.length === 0) return;
    const { projectId } = parsed.data;
    await this.txRunner.run(async (tx) => {
      const { numbers, depth } = await numbersOf(this.cells, 'project', projectId, fieldIds, tx);
      if (numbers.length === 0) return;
      this.logger.debug({ projectId, numbers }, 'Пересчёт формул проекта');
      await this.formulas.recalcProjectCells(
        tx,
        event.actorId ?? null,
        projectId,
        numbers,
        depth + 1,
      );
    });
  }
}

/** Пересчёт формул папки по значениям её атрибутов (`project.node_updated`). */
@Injectable()
export class ProjectNodeFormulaRecalcHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_UPDATED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaService,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectNodeFormulaRecalcHandler.name);
  }

  async handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const parsed = projectNodeUpdatedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return;
    const fieldIds = changedFieldIds(parsed.data.fields);
    if (fieldIds.length === 0) return;
    const { projectId, nodeId } = parsed.data;
    await this.txRunner.run(async (tx) => {
      const { numbers, depth } = await numbersOf(this.cells, 'node', nodeId, fieldIds, tx);
      if (numbers.length === 0) return;
      this.logger.debug({ projectId, nodeId, numbers }, 'Пересчёт формул папки');
      await this.formulas.recalcNodeCells(
        tx,
        event.actorId ?? null,
        projectId,
        nodeId,
        numbers,
        depth + 1,
      );
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
    private readonly formulas: ProjectFormulaService,
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
 * Удаление папки (`project.node_deleted`): ячейки удалённого хоста умирают
 * вместе с ним (Р4, «смерть связей»), формулы родителя и проекта
 * пересчитываются — выборки папки изменились.
 */
@Injectable()
export class ProjectNodeDeletedFormulaHandler {
  static readonly eventType = PROJECT_EVENTS.NODE_DELETED;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly formulas: ProjectFormulaService,
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
    private readonly formulas: ProjectFormulaService,
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
