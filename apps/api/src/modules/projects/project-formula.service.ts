import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  Permission,
  type AuthUser,
  type FormulaMovePreviewResponse,
  type FormulaNode,
  type FormulaResponse,
} from '@nodus/contracts';

import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { FORMULA_CELLS, type FormulaCells } from '../custom-fields/ports/formula-cells.port.js';
import {
  TASK_PROJECT_READER,
  type TaskProjectReader,
} from '../tasks/ports/task-project-reader.port.js';
import { ProjectFormulaEvents } from './project-formula-events.js';
import { ProjectNodesRepository } from './project-nodes.repository.js';
import { ProjectValuesWriter } from './project-values.writer.js';
import { loadForStructureManage } from './project-structure.access.js';
import {
  childrenByParent,
  isDescendantOf,
  nodeInvalid,
  parentOf,
  subtreeIds,
} from './project-structure.tree.js';
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
 * руководство или project.manage, архив — заморозка). Пересчёт по
 * зависимостям — `ProjectFormulaRecalcService` (I5). Dry-run переноса
 * (`movePreview`, Р10) — чтение: формулы считаются «как после переноса»
 * портом, в БД не пишется ничего.
 */
@Injectable()
export class ProjectFormulaService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly projects: ProjectsService,
    private readonly nodes: ProjectNodesRepository,
    private readonly writer: ProjectValuesWriter,
    private readonly events: ProjectFormulaEvents,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
    @Inject(TASK_PROJECT_READER) private readonly taskReader: TaskProjectReader,
  ) {}

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
      await this.events.emitChanged(
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
      await this.events.emitChanged(tx, user.id, 'project', projectId, projectId, fieldId, false);
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
      await this.events.emitChanged(
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
      await this.events.emitChanged(tx, user.id, 'node', nodeId, projectId, fieldId, false);
    });
  }

  // ===== Перенос (move-preview, Р10) =====

  /**
   * Dry-run переноса папки: какие формульные значения изменятся, если узел
   * окажется у нового родителя (`parentId=null` — корень). Ничего не пишет и
   * не пересчитывает — только считает формулы «как после переноса» портом
   * `FORMULA_CELLS.preview` с подменой места (Р10).
   *
   * Сравниваются папки ПОДДЕРЕВА (у них меняется цепочка предков) и задачи
   * этих папок (формула папки — их источник). Цикл и несуществующие узлы
   * отсекаются теми же правилами, что у самого переноса, — диалог не обещает
   * то, что перенос запретит.
   */
  async movePreview(
    user: AuthUser,
    projectId: string,
    nodeId: string,
    parentId: string | null,
  ): Promise<FormulaMovePreviewResponse> {
    await loadForStructureManage(this.projects, user, projectId);
    const tree = await this.nodes.listByProject(projectId);
    if (!tree.some((node) => node.id === nodeId)) throw nodeInvalid(nodeId);
    const targetParent = parentId === null ? null : (tree.find((n) => n.id === parentId) ?? null);
    if (parentId !== null && !targetParent) throw nodeInvalid(parentId);
    if (
      targetParent &&
      (targetParent.id === nodeId || isDescendantOf(parentOf(tree), targetParent.id, nodeId))
    ) {
      throw new DomainException(
        ErrorCode.PROJECT_NODE_CYCLE,
        'Cannot move a node into its own subtree',
        { nodeId },
      );
    }
    const nodes = subtreeIds(childrenByParent(tree), nodeId).slice(0, 100);
    // Видимость актора (Р7): конфиденциальные задачи чужих не раскрываются
    // даже в подписи диффа; потолок — диалог, а не пересчёт тысяч записей.
    const taskIds = (await this.taskReader.taskIdsInNodes(projectId, nodes, user.id)).slice(0, 100);
    // Дерево в БД ещё старое: подмена родителя ровно у переносимого узла —
    // остальные папки поддерева едут вместе с ним, их parentId не меняется.
    const override = { nodeParent: { [nodeId]: parentId } };
    const [nodeChanges, taskChanges] = await Promise.all([
      this.cells.preview('node', nodes, override),
      this.cells.preview('task', taskIds, override),
    ]);
    return { changes: [...nodeChanges, ...taskChanges] };
  }

  /** Правка полей проекта: руководство или project.manage; архив — заморозка. */
  private async requireManage(user: AuthUser, projectId: string) {
    const { row } = await this.projects.loadForManage(user, projectId);
    if (row.status === 'archived' && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
      throw DomainException.forbidden('Archived project fields are managed by project.manage');
    }
    return row;
  }
}
