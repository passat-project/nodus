import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOM_FIELD_EVENTS,
  Permission,
  type AuthUser,
  type FormulaHostKind,
  type FormulaNode,
  type FormulaResponse,
} from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import {
  FORMULA_CELLS,
  type FormulaCellRef,
  type FormulaCells,
} from '../custom-fields/ports/formula-cells.port.js';
import { projectAudience } from './project-audience.js';
import { ProjectNodesRepository } from './project-nodes.repository.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectsRepository } from './projects.repository.js';
import { ProjectValuesWriter } from './project-values.writer.js';
import { loadForStructureManage } from './project-structure.access.js';
import { childrenByParent, nodeInvalid } from './project-structure.tree.js';
import { ProjectsService } from './projects.service.js';

/**
 * Формула ячейки атрибута проекта и папки структуры (#632, Р10): мутации
 * живут у владельца хоста (I3). Порт `FORMULA_CELLS` проверяет формулу,
 * хранит её и вычисляет результат; значение материализует штатный писатель
 * модуля (`ProjectValuesWriter`, Р4) — события хоста уезжают обычным путём,
 * `custom_field.formula_changed` (O4) — адресно аудитории проекта.
 *
 * Права: чтение — видимость карточки/папки; мутации — как у правки полей
 * (`ProjectsService.loadForManage`) и структуры (`loadForStructureManage`:
 * руководство или project.manage, архив — заморозка).
 */
@Injectable()
export class ProjectFormulaService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly projects: ProjectsService,
    private readonly repo: ProjectsRepository,
    private readonly nodes: ProjectNodesRepository,
    private readonly writer: ProjectValuesWriter,
    private readonly participants: ProjectParticipantsRepository,
    private readonly eventBus: EventBus,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProjectFormulaService.name);
  }

  // ===== Проект =====

  /** Эффективная формула ячейки проекта (своя или типа): читает зритель. */
  async read(user: AuthUser, projectId: string, fieldId: string): Promise<FormulaResponse> {
    await this.projects.assertVisible(user, projectId);
    return this.cells.read('project', projectId, fieldId);
  }

  /** Поставить/заменить свою формулу проекта: проверка → запись → значение. */
  async save(
    user: AuthUser,
    projectId: string,
    fieldId: string,
    ast: FormulaNode,
  ): Promise<FormulaResponse> {
    await this.requireManage(user, projectId);
    return this.txRunner.run(async (tx) => {
      const outcome = await this.cells.save(tx, {
        hostKind: 'project',
        hostId: projectId,
        fieldId,
        ast,
        actorId: user.id,
      });
      await this.writer.writeProject(tx, user.id, projectId, fieldId, outcome.value);
      await this.emitChanged(
        tx,
        user.id,
        'project',
        projectId,
        projectId,
        fieldId,
        outcome.error !== null,
      );
      return { ast, origin: 'own' as const };
    });
  }

  /** Снять формулу проекта: последнее значение остаётся снимком (Р5). */
  async remove(user: AuthUser, projectId: string, fieldId: string): Promise<void> {
    await this.requireManage(user, projectId);
    await this.txRunner.run(async (tx) => {
      await this.cells.remove(tx, { hostKind: 'project', hostId: projectId, fieldId });
      await this.emitChanged(tx, user.id, 'project', projectId, projectId, fieldId, false);
    });
  }

  // ===== Папка структуры =====

  async readNode(
    user: AuthUser,
    projectId: string,
    nodeId: string,
    fieldId: string,
  ): Promise<FormulaResponse> {
    await this.projects.assertVisible(user, projectId);
    if (!(await this.nodes.findInProject(projectId, nodeId))) throw nodeInvalid(nodeId);
    return this.cells.read('node', nodeId, fieldId);
  }

  async saveNode(
    user: AuthUser,
    projectId: string,
    nodeId: string,
    fieldId: string,
    ast: FormulaNode,
  ): Promise<FormulaResponse> {
    await loadForStructureManage(this.projects, user, projectId);
    if (!(await this.nodes.findInProject(projectId, nodeId))) throw nodeInvalid(nodeId);
    return this.txRunner.run(async (tx) => {
      const outcome = await this.cells.save(tx, {
        hostKind: 'node',
        hostId: nodeId,
        fieldId,
        ast,
        actorId: user.id,
      });
      await this.writer.writeNode(tx, user.id, projectId, nodeId, fieldId, outcome.value);
      await this.emitChanged(
        tx,
        user.id,
        'node',
        nodeId,
        projectId,
        fieldId,
        outcome.error !== null,
      );
      return { ast, origin: 'own' as const };
    });
  }

  async removeNode(
    user: AuthUser,
    projectId: string,
    nodeId: string,
    fieldId: string,
  ): Promise<void> {
    await loadForStructureManage(this.projects, user, projectId);
    if (!(await this.nodes.findInProject(projectId, nodeId))) throw nodeInvalid(nodeId);
    await this.txRunner.run(async (tx) => {
      await this.cells.remove(tx, { hostKind: 'node', hostId: nodeId, fieldId });
      await this.emitChanged(tx, user.id, 'node', nodeId, projectId, fieldId, false);
    });
  }

  // ===== Пересчёт по зависимостям (Р4/Р8) =====

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
    await this.emitChanged(
      tx,
      actorId,
      cell.hostKind,
      cell.hostId,
      projectId,
      cell.fieldId,
      outcome.error !== null,
    );
  }

  /** Правка полей проекта: руководство или project.manage; архив — заморозка. */
  private async requireManage(user: AuthUser, projectId: string) {
    const { row } = await this.projects.loadForManage(user, projectId);
    if (row.status === 'archived' && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
      throw DomainException.forbidden('Archived project fields are managed by project.manage');
    }
    return row;
  }

  /** Адресное событие формулы (O4): без значений, только состояние ошибки. */
  private async emitChanged(
    tx: TransactionClient,
    actorId: string | null,
    hostKind: FormulaHostKind,
    hostId: string,
    projectId: string,
    fieldId: string,
    hasError: boolean,
  ): Promise<void> {
    const project = await this.repo.findById(projectId, tx);
    const audience = project ? await projectAudience(this.participants, project, tx) : [];
    await this.eventBus.emit(
      tx,
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      { hostKind, hostId, fieldId, hasError, audience },
      {
        actorId: actorId ?? undefined,
        aggregateType: hostKind === 'node' ? 'project_node' : 'project',
        aggregateId: hostId,
      },
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
