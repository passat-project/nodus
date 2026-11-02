import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  NODE_LIMITS,
  PROJECT_EVENTS,
  type AuthUser,
  type CreateProjectNodeBody,
  type ProjectNode,
  type ProjectStructureResponse,
  type UpdateProjectNodeBody,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import {
  TASK_PROJECT_READER,
  type TaskProjectReader,
} from '../tasks/ports/task-project-reader.port.js';
import { loadForStructureManage } from './project-structure.access.js';
import { nodeToDto } from './project-structure.mapper.js';
import { NodeKindsRepository } from './project-node-kinds.repository.js';
import { ProjectNodesRepository, type ProjectNodeRow } from './project-nodes.repository.js';
import { ProjectsService } from './projects.service.js';
import {
  childrenByParent,
  limitError,
  nodeDepth,
  nodeInvalid,
  orderKeyFor,
  parentOf,
  type TreeNodeLike,
} from './project-structure.tree.js';

/**
 * Дерево проекта (#467, ADR-0030 «Дополнение»): узлы-папки со свободной
 * вложенностью, задачи — листья (tasks.nodeId, агрегаты — порт
 * TASK_PROJECT_READER). Права — как у правки полей проекта (руководство или
 * project.manage, ProjectsService.loadForManage); архив — заморозка (400).
 * Все мутации — под advisory-локом структуры проекта; события project.node_*
 * — outbox в той же транзакции (I9). Срез узлов без курсора (≤1000) —
 * легализованное исключение (дополнение ADR-0030).
 *
 * Перенос узла — ProjectStructureMoveService (I5); доступ — access-гард;
 * DTO — mapper; чистые расчёты — project-structure.tree.ts.
 */
@Injectable()
export class ProjectStructureService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly projects: ProjectsService,
    private readonly nodes: ProjectNodesRepository,
    private readonly kinds: NodeKindsRepository,
    @Inject(TASK_PROJECT_READER) private readonly taskReader: TaskProjectReader,
  ) {}

  /** GET /projects/:id/structure: узлы (плоско, по order) + rollups + виды. */
  async structure(user: AuthUser, projectId: string): Promise<ProjectStructureResponse> {
    await this.projects.assertVisible(user, projectId);
    const [rows, rollups, kinds] = await Promise.all([
      this.nodes.listByProject(projectId),
      this.taskReader.nodeRollups(projectId),
      this.kinds.list(),
    ]);
    const byNode = new Map(rollups.map((rollup) => [rollup.nodeId, rollup]));
    return {
      nodes: rows.map((row) => nodeToDto(row, byNode.get(row.id) ?? null)),
      kinds,
      // #556 UI-пакет: заглушка — пачка ссылок значений появится в пакете 2.
      customFieldRefs: [],
    };
  }

  async create(
    user: AuthUser,
    projectId: string,
    body: CreateProjectNodeBody,
  ): Promise<ProjectNode> {
    const created = await this.createMany(user, projectId, {
      parentId: body.parentId ?? null,
      kindId: body.kindId,
      names: [body.name],
      code: body.code,
    });
    return created[0]!;
  }

  /** Пакетное создание («Здания: поз. 1–3»): лимиты — на пакет целиком. */
  async createMany(
    user: AuthUser,
    projectId: string,
    body: {
      parentId: string | null;
      kindId: string;
      names: string[];
      code?: string;
    },
  ): Promise<ProjectNode[]> {
    await loadForStructureManage(this.projects, user, projectId);
    return this.txRunner.run(async (tx) => {
      await this.nodes.lockStructure(tx, projectId);
      const tree = await this.nodes.listByProject(projectId, tx);
      const kind = await this.assertKindAlive(body.kindId);
      const parent = this.assertParent(tree, body.parentId);
      if (body.names.length > NODE_LIMITS.nodesPerProject - tree.length) {
        throw limitError('nodes_per_project', NODE_LIMITS.nodesPerProject);
      }
      const siblings = childrenByParent(tree).get(parent?.id ?? null) ?? [];
      if (siblings.length + body.names.length > NODE_LIMITS.childrenPerParent) {
        throw limitError('children_per_parent', NODE_LIMITS.childrenPerParent);
      }
      const depth = parent ? nodeDepth(parentOf(tree), parent.id) + 1 : 1;
      if (depth > NODE_LIMITS.depth) throw limitError('depth', NODE_LIMITS.depth);
      if (body.code !== undefined && body.code !== null) {
        await this.assertCodeFree(tx, projectId, body.code, null);
      }
      const meta = { actorId: user.id, aggregateType: 'project_node' };
      const created: ProjectNodeRow[] = [];
      for (const name of body.names) {
        const orders = [...siblings.map((s) => s.order), ...created.map((s) => s.order)];
        const node = await this.nodes.create(tx, {
          projectId,
          parentId: parent?.id ?? null,
          kindId: kind.id,
          name,
          code: created.length === 0 ? (body.code ?? null) : null,
          order: orderKeyFor(orders, null, 'end'),
        });
        created.push(node);
        await this.eventBus.emit(
          tx,
          PROJECT_EVENTS.NODE_CREATED,
          {
            projectId,
            nodeId: node.id,
            parentId: node.parentId,
            kindId: node.kindId,
            name: node.name,
          },
          { ...meta, aggregateId: node.id },
        );
      }
      return created.map((node) => nodeToDto(node, null));
    });
  }

  /** Правка узла: имя/код(null очищает)/вид-ярлык. */
  async update(
    user: AuthUser,
    projectId: string,
    nodeId: string,
    body: UpdateProjectNodeBody,
  ): Promise<ProjectNode> {
    await loadForStructureManage(this.projects, user, projectId);
    return this.txRunner.run(async (tx) => {
      await this.nodes.lockStructure(tx, projectId);
      const node = await this.nodes.findInProject(projectId, nodeId);
      if (!node) throw nodeInvalid(nodeId);
      const patch: { name?: string; code?: string | null; kindId?: string } = {};
      const fields: string[] = [];
      if (body.name !== undefined) {
        patch.name = body.name;
        fields.push('name');
      }
      if (body.code !== undefined) {
        if (body.code !== null && body.code !== node.code) {
          await this.assertCodeFree(tx, projectId, body.code, node.id);
        }
        patch.code = body.code;
        fields.push('code');
      }
      if (body.kindId !== undefined && body.kindId !== node.kindId) {
        patch.kindId = (await this.assertKindAlive(body.kindId)).id;
        fields.push('kindId');
      }
      await this.nodes.update(tx, node.id, patch);
      await this.eventBus.emit(
        tx,
        PROJECT_EVENTS.NODE_UPDATED,
        {
          projectId,
          nodeId: node.id,
          fields,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.code !== undefined ? { code: patch.code } : {}),
          ...(patch.kindId !== undefined ? { kindId: patch.kindId } : {}),
        },
        { actorId: user.id, aggregateType: 'project_node', aggregateId: node.id },
      );
      return nodeToDto({ ...node, ...patch } as ProjectNodeRow, null);
    });
  }

  /** Удаление пустого узла насовсем (архивации узлов нет, вердикт 30.10). */
  async remove(user: AuthUser, projectId: string, nodeId: string): Promise<void> {
    await loadForStructureManage(this.projects, user, projectId);
    await this.txRunner.run(async (tx) => {
      await this.nodes.lockStructure(tx, projectId);
      const node = await this.nodes.findInProject(projectId, nodeId);
      if (!node) throw nodeInvalid(nodeId);
      const tree = await this.nodes.listByProject(projectId, tx);
      if ((childrenByParent(tree).get(node.id) ?? []).length > 0) {
        throw new DomainException(ErrorCode.PROJECT_NODE_NOT_EMPTY, 'Node has child nodes', {
          nodeId,
        });
      }
      const rollups = await this.taskReader.nodeRollups(projectId);
      if ((rollups.find((entry) => entry.nodeId === node.id)?.taskCount ?? 0) > 0) {
        throw new DomainException(ErrorCode.PROJECT_NODE_NOT_EMPTY, 'Node has tasks', { nodeId });
      }
      await this.nodes.remove(tx, node.id);
      await this.eventBus.emit(
        tx,
        PROJECT_EVENTS.NODE_DELETED,
        { projectId, nodeId: node.id, parentId: node.parentId },
        { actorId: user.id, aggregateType: 'project_node', aggregateId: node.id },
      );
    });
  }

  // ===== Общее =====

  private async assertKindAlive(kindId: string) {
    const kind = await this.kinds.findActive(kindId);
    if (kind) return kind;
    if (await this.kinds.findById(kindId)) {
      throw new DomainException(ErrorCode.PROJECT_NODE_KIND_ARCHIVED, 'Node kind is archived', {
        kindId,
      });
    }
    throw new DomainException(ErrorCode.PROJECT_NODE_INVALID, 'Node kind is not available', {
      kindId,
    });
  }

  private assertParent(tree: readonly TreeNodeLike[], parentId: string | null) {
    if (parentId === null) return null;
    const parent = tree.find((entry) => entry.id === parentId);
    if (!parent) throw nodeInvalid(parentId);
    return parent;
  }

  private async assertCodeFree(
    tx: TransactionClient,
    projectId: string,
    code: string,
    excludeId: string | null,
  ): Promise<void> {
    if (await this.nodes.codeTaken(projectId, code, excludeId, tx)) {
      throw new DomainException(
        ErrorCode.PROJECT_NODE_CODE_TAKEN,
        'Node code is already taken in this project',
        { code },
      );
    }
  }
}
