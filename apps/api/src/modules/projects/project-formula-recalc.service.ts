import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import {
  FORMULA_CELLS,
  type FormulaCellRef,
  type FormulaCells,
  type FormulaRecalcOutcome,
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
  /** Потолок синхронного пересчёта в tx PATCH (#632): массовый каскад
   *  остаётся диспетчеру — tx пользователя не удлиняется. */
  private static readonly SYNC_RECALC_LIMIT = 20;
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
    // Замок хоста ДО ячеек: тот же порядок, что у PATCH проекта (40P01).
    if (!(await this.writer.lockProject(tx, projectId))) return;
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
    await this.writer.lockNode(tx, projectId, nodeId);
    for (const cell of dedupe([...dependent, ...own])) {
      await this.recalcCell(tx, actorId, projectId, cell, depth);
    }
  }

  /**
   * Синхронный пересчёт ячеек папки в транзакции PATCH (#632): ответ
   * мутации и следующий GET обязаны нести свежие значения — асинхронный
   * обработчик опаздывает на цикл диспетчера (карточка «отстаёт на шаг»).
   * Свыше лимита ячеек — пропуск: каскад догонит диспетчер.
   */
  async recalcNodeAfterValuesChange(
    tx: TransactionClient,
    actorId: string | null,
    projectId: string,
    nodeId: string,
    fieldIds: readonly string[],
  ): Promise<void> {
    const numbers = await this.numbersOf(tx, fieldIds);
    if (numbers.length === 0) return;
    if (!(await this.withinSyncLimit(tx, 'node', nodeId, numbers))) return;
    await this.recalcNodeCells(tx, actorId, projectId, nodeId, numbers, 1);
  }

  /**
   * Синхронный пересчёт ячеек проекта в транзакции PATCH (#632) —
   * симметрично папке: свежий ответ мутации без ожидания диспетчера.
   */
  async recalcProjectAfterValuesChange(
    tx: TransactionClient,
    actorId: string | null,
    projectId: string,
    fieldIds: readonly string[],
  ): Promise<void> {
    const numbers = await this.numbersOf(tx, fieldIds);
    if (numbers.length === 0) return;
    if (!(await this.withinSyncLimit(tx, 'project', projectId, numbers))) return;
    await this.recalcProjectCells(tx, actorId, projectId, numbers, 1);
  }

  /** Номера определений изменённых атрибутов (адрес зависимостей). */
  private async numbersOf(tx: TransactionClient, fieldIds: readonly string[]): Promise<number[]> {
    const numbers: number[] = [];
    for (const fieldId of fieldIds) {
      const number = await this.cells.numberByDefinitionId(fieldId, tx);
      if (number !== null) numbers.push(number);
    }
    return numbers;
  }

  /** Мал ли каскад для синхронного пересчёта в tx пользователя. */
  private async withinSyncLimit(
    tx: TransactionClient,
    hostKind: 'project' | 'node',
    hostId: string,
    numbers: readonly number[],
  ): Promise<boolean> {
    const dependent = await this.cells.dependentCellsByValues(hostKind, hostId, numbers, tx);
    const own = await this.cells.cellsForHost(hostKind, hostId, tx);
    const total = dedupe([...dependent, ...own]).length;
    return total > 0 && total <= ProjectFormulaRecalcService.SYNC_RECALC_LIMIT;
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
    for (const nodeId of [...nodeIds].sort()) {
      await this.writer.lockNode(tx, projectId, nodeId);
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
    // Чужие хосты (task/letter) пересчитывают их собственные модули: писать
    // их значения здесь нельзя (I3), иначе «находка» станет порчей данных.
    if (cell.hostKind !== 'project' && cell.hostKind !== 'node') return;
    const outcome = await this.recalcOrNull(tx, cell, depth);
    if (!outcome) return;
    if (outcome.silent) return;
    if (outcome.changed) {
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
    }
    // formula_changed — только при смене наличия ошибки (O4).
    if (outcome.errorChanged) {
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

  /**
   * Пересчёт ячейки с изоляцией сбоя (Р4): падение чтения источника или
   * вычисления одной ячейки не должно валить транзакцию партии и превращать
   * событие в вечный retry диспетчера — остальные ячейки пересчитываются.
   */
  private async recalcOrNull(
    tx: TransactionClient,
    cell: FormulaCellRef,
    depth: number,
  ): Promise<FormulaRecalcOutcome | null> {
    try {
      return await this.cells.recalc(tx, cell, depth);
    } catch (error) {
      this.logger.warn(
        { cell, error: error instanceof Error ? error.message : String(error) },
        'Ячейка формулы не пересчитана',
      );
      return null;
    }
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
