import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import {
  FORMULA_CELLS,
  type FormulaCellRef,
  type FormulaCells,
} from '../custom-fields/ports/formula-cells.port.js';
import { ProjectFormulaEvents } from './project-formula-events.js';
import { ProjectNodesRepository } from './project-nodes.repository.js';
import { ProjectValuesWriter } from './project-values.writer.js';
import { childrenByParent } from './project-structure.tree.js';

/**
 * Пересчёт формул проекта и папок по зависимостям (#632, Р4/Р8): обработчики
 * событий находят затронутые хосты, `FORMULA_CELLS.recalc` пересчитывает
 * ячейку, значение материализует писатель модуля, событие хоста уезжает
 * штатным путём. Сбой одной ячейки изолирован (Р4) — партия не падает.
 */
@Injectable()
export class ProjectFormulaRecalcService {
  constructor(
    private readonly nodes: ProjectNodesRepository,
    private readonly writer: ProjectValuesWriter,
    private readonly events: ProjectFormulaEvents,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectFormulaRecalcService.name);
  }

  /** Ячейки проекта: зависимые от номеров значений + все свои (Р4). */
  async recalcProjectCells(
    tx: TransactionClient,
    actorId: string | null,
    projectId: string,
    numbers: readonly number[],
    depth: number,
  ): Promise<void> {
    const dependent =
      numbers.length > 0
        ? await this.cells.dependentCellsByValues('project', projectId, numbers, tx)
        : [];
    const own = await this.cells.cellsForHost('project', projectId, tx);
    for (const cell of dedupe([...dependent, ...own])) {
      await this.recalcCell(tx, actorId, projectId, cell, depth);
    }
  }

  /** Ячейки папки: зависимые от номеров значений + все свои (Р4). */
  async recalcNodeCells(
    tx: TransactionClient,
    actorId: string | null,
    projectId: string,
    nodeId: string,
    numbers: readonly number[],
    depth: number,
  ): Promise<void> {
    const dependent =
      numbers.length > 0
        ? await this.cells.dependentCellsByValues('node', nodeId, numbers, tx)
        : [];
    const own = await this.cells.cellsForHost('node', nodeId, tx);
    for (const cell of dedupe([...dependent, ...own])) {
      await this.recalcCell(tx, actorId, projectId, cell, depth);
    }
  }

  /**
   * Пересчёт поддерева (перенос/удаление папки, #632): цепочка предков
   * меняется у узла и всех его потомков. Зависимости `tree:project:<id>`
   * порт по ключу не отдаёт — пересчитываем ячейки затронутых хостов
   * (Р4: «поддерево + старый/новый родитель»).
   */
  async recalcStructure(
    tx: TransactionClient,
    actorId: string | null,
    projectId: string,
    rootIds: readonly string[],
    depth: number,
  ): Promise<void> {
    const roots = [...new Set(rootIds)];
    if (roots.length === 0) return;
    const tree = await this.nodes.listByProject(projectId, tx);
    const children = childrenByParent(tree);
    const known = new Set(tree.map((node) => node.id));
    const affected = new Set<string>();
    for (const root of roots) {
      if (!known.has(root)) continue;
      const stack = [root];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (affected.has(current)) continue;
        affected.add(current);
        for (const child of children.get(current) ?? []) stack.push(child.id);
      }
    }
    await this.recalcNodes(tx, actorId, projectId, [...affected], depth);
  }

  /** Пересчёт ячеек набора папок (смена вида, удаление атрибута). */
  async recalcNodes(
    tx: TransactionClient,
    actorId: string | null,
    projectId: string,
    nodeIds: readonly string[],
    depth: number,
  ): Promise<void> {
    for (const nodeId of nodeIds) {
      const cells = await this.cells.cellsForHost('node', nodeId, tx);
      for (const cell of cells) await this.recalcCell(tx, actorId, projectId, cell, depth);
    }
  }

  /** Одна ячейка: пересчёт → материализация → адресное событие (Р4). */
  private async recalcCell(
    tx: TransactionClient,
    actorId: string | null,
    projectId: string,
    cell: FormulaCellRef,
    depth: number,
  ): Promise<void> {
    const outcome = await this.cells.recalc(tx, cell, depth);
    if (outcome.silent || !outcome.changed) return;
    try {
      if (cell.hostKind === 'project') {
        await this.writer.writeProject(tx, actorId, projectId, cell.fieldId, outcome.value);
      } else {
        await this.writer.writeNode(
          tx,
          actorId,
          projectId,
          cell.hostId,
          cell.fieldId,
          outcome.value,
        );
      }
    } catch (error) {
      // Изоляция сбоев per-cell (Р4): «ядовитая» ячейка не валит партию.
      this.logger.debug(
        { cell, error: error instanceof Error ? error.message : String(error) },
        'Значение формулы не записано',
      );
      return;
    }
    await this.events.emitChanged(
      tx,
      actorId,
      cell.hostKind,
      cell.hostId,
      projectId,
      cell.fieldId,
      outcome.error !== null,
    );
  }
}

/** Уникальные ячейки (зависимые и свои могут пересечься). */
function dedupe(refs: readonly FormulaCellRef[]): FormulaCellRef[] {
  const seen = new Set<string>();
  const result: FormulaCellRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.cellId)) continue;
    seen.add(ref.cellId);
    result.push(ref);
  }
  return result;
}
