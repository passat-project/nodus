import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  NODE_LIMITS,
  PROJECT_EVENTS,
  type AuthUser,
  type MoveProjectNodeBody,
  type ProjectNode,
} from '@nodus/contracts';

import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { ProjectNodesRepository, type ProjectNodeRow } from './project-nodes.repository.js';
import { nodeToDto } from './project-structure.mapper.js';
import { FORMULA_CELLS, type FormulaCells } from '../custom-fields/ports/formula-cells.port.js';
import { ProjectsService } from './projects.service.js';
import {
  childrenByParent,
  isDescendantOf,
  limitError,
  nodeDepth,
  nodeInvalid,
  orderKeyFor,
  parentOf,
  subtreeHeight,
} from './project-structure.tree.js';
import { loadForStructureManage } from './project-structure.access.js';

/**
 * Перенос узла (#467): самый тонкий механизм структуры — циклы, глубина
 * поддерева, якорь позиции. Выделен из ProjectStructureService (I5): свой
 * advisory-лок и общий гард доступа; порядок ключей — fractional (COLLATE "C").
 */
@Injectable()
export class ProjectStructureMoveService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly projects: ProjectsService,
    private readonly nodes: ProjectNodesRepository,
    @Inject(FORMULA_CELLS) private readonly formulas: FormulaCells,
  ) {}

  /** Перенос узла (DnD/меню): родитель + позиция среди его детей. */
  async move(
    user: AuthUser,
    projectId: string,
    nodeId: string,
    body: MoveProjectNodeBody,
  ): Promise<ProjectNode> {
    await loadForStructureManage(this.projects, user, projectId);
    return this.txRunner.run(async (tx) => {
      await this.nodes.lockStructure(tx, projectId);
      const tree = await this.nodes.listByProject(projectId, tx);
      const node = tree.find((entry) => entry.id === nodeId);
      if (!node) throw nodeInvalid(nodeId);
      const parents = parentOf(tree);
      const targetParent =
        body.parentId === null ? null : (tree.find((entry) => entry.id === body.parentId) ?? null);
      if (body.parentId !== null && !targetParent) throw nodeInvalid(body.parentId);
      if (
        targetParent &&
        (targetParent.id === node.id || isDescendantOf(parents, targetParent.id, node.id))
      ) {
        throw new DomainException(
          ErrorCode.PROJECT_NODE_CYCLE,
          'Cannot move a node into its own subtree',
          { nodeId },
        );
      }
      // Поддерево едет целиком: глубина цели + высота поддерева ≤ лимита.
      const targetDepth = targetParent ? nodeDepth(parents, targetParent.id) + 1 : 1;
      if (targetDepth + subtreeHeight(childrenByParent(tree), node.id) - 1 > NODE_LIMITS.depth) {
        throw limitError('depth', NODE_LIMITS.depth);
      }
      // Якорь — ребёнок целевого родителя (не сам узел); братья — без узла.
      const siblings = (childrenByParent(tree).get(targetParent?.id ?? null) ?? []).filter(
        (entry) => entry.id !== node.id,
      );
      const anchor = body.beforeId ?? body.afterId ?? null;
      const anchorOrder = anchor ? (siblings.find((e) => e.id === anchor)?.order ?? null) : null;
      if (anchor && anchorOrder === null) throw nodeInvalid(anchor);
      const order = orderKeyFor(
        siblings.map((entry) => entry.order),
        anchorOrder,
        body.beforeId ? 'before' : 'after',
      );
      const previousParentId = node.parentId;
      await this.nodes.update(tx, node.id, { parentId: targetParent?.id ?? null, order });
      await this.eventBus.emit(
        tx,
        PROJECT_EVENTS.NODE_MOVED,
        {
          projectId,
          nodeId: node.id,
          parentId: targetParent?.id ?? null,
          previousParentId,
        },
        { actorId: user.id, aggregateType: 'project_node', aggregateId: node.id },
      );
      const moved = { ...node, parentId: targetParent?.id ?? null, order } as ProjectNodeRow;
      // Формульное состояние — сразу в DTO переноса: карточка не должна
      // оставаться редактируемой до фонового пересчёта.
      const state = (
        await this.formulas.stateFor('node', [node.id], tx, new Map([[node.id, node.kindId]]))
      ).get(node.id);
      return nodeToDto(moved, null, state);
    });
  }
}
