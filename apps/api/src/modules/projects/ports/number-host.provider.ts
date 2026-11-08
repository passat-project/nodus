/* eslint-disable nodus-internal/max-lines-warn -- носители «проект/папка» (#630): место, имена и запись номера — один адаптер */
import { Inject, Injectable } from '@nestjs/common';
import {
  PROJECT_EVENTS,
  type NumberContainerHit,
  type NumberContainerRef,
  type NumberHostKind,
} from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { ProjectGroupsRepository } from '../project-groups.repository.js';
import { ProjectNodesRepository } from '../project-nodes.repository.js';
import { ProjectTypesRepository } from '../project-types.repository.js';
import { ProjectsRepository } from '../projects.repository.js';
import {
  PROJECT_READER,
  type NumberNodeContext,
  type NumberProjectContext,
  type ProjectReader,
} from './project-reader.port.js';
import type {
  NumberActor,
  NumberHostProvider,
  NumberHostRecord,
  NumberTarget,
} from '../../custom-fields/ports/number-host.port.js';

/**
 * Носители номеров «проекты» и «папки» (#630): проект — внутри портфеля и
 * типа проекта, папка — внутри папок-предков, проекта и его портфеля.
 * Значения условий и поля-вставки читаются из дерева проекта; имена и пути
 * для «Текущих счетов» — здесь же (таблицы проектов чужим модулям закрыты).
 */
@Injectable()
export class ProjectNumberHostProvider implements NumberHostProvider {
  static readonly numberHostKinds: readonly NumberHostKind[] = ['project', 'node'];
  readonly numberHostKinds = ProjectNumberHostProvider.numberHostKinds;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsRepository,
    private readonly nodes: ProjectNodesRepository,
    private readonly groups: ProjectGroupsRepository,
    private readonly types: ProjectTypesRepository,
    @Inject(PROJECT_READER) private readonly reader: ProjectReader,
    private readonly events: EventBus,
  ) {}

  async listHosts(
    tx: TransactionClient,
    actor: NumberActor,
    typeIds: readonly string[],
  ): Promise<NumberHostRecord[]> {
    const ids = new Set(typeIds);
    const projectTypeIds = [...ids];
    const nodeKindIds = [...ids];
    const [contexts, scope] = await Promise.all([
      this.reader.numberHostsOfTypes(projectTypeIds, nodeKindIds, tx),
      this.reader.viewScopeFor(actor),
    ]);
    const visible = new Set(scope.visibleProjectIds);
    const projectById = new Map(contexts.projects.map((project) => [project.id, project]));
    const nodeById = new Map(contexts.nodes.map((node) => [node.id, node]));
    const out: NumberHostRecord[] = [];
    for (const project of contexts.projects) {
      if (!ids.has(project.typeId)) continue;
      out.push({
        kind: 'project',
        id: project.id,
        name: project.name,
        typeId: project.typeId,
        order: project.createdAt.getTime(),
        visible: visible.has(project.id),
        target: projectTarget(project),
      });
    }
    for (const node of contexts.nodes) {
      if (!ids.has(node.kindId)) continue;
      const project = projectById.get(node.projectId);
      if (!project) continue;
      const chain = folderChain(node, nodeById);
      out.push({
        kind: 'node',
        id: node.id,
        name: node.name,
        typeId: node.kindId,
        order: node.createdAt.getTime(),
        visible: visible.has(project.id),
        target: nodeTarget(node, chain, project),
      });
    }
    return out;
  }

  async findHost(
    tx: TransactionClient,
    actor: NumberActor,
    kind: NumberHostKind,
    id: string,
  ): Promise<NumberHostRecord | null> {
    const scope = await this.reader.viewScopeFor(actor);
    const visible = new Set(scope.visibleProjectIds);
    if (kind === 'project') {
      const project = (await this.reader.numberContext([id], [], tx)).projects[0];
      if (!project || !visible.has(project.id)) return null;
      return {
        kind: 'project',
        id: project.id,
        name: project.name,
        typeId: project.typeId,
        order: project.createdAt.getTime(),
        visible: true,
        target: projectTarget(project),
      };
    }
    if (kind === 'node') {
      const contexts = await this.reader.numberContext([], [id], tx);
      const node = contexts.nodes.find((entry) => entry.id === id);
      const project = node ? contexts.projects.find((entry) => entry.id === node.projectId) : null;
      if (!node || !project || !visible.has(project.id)) return null;
      const nodeById = new Map(contexts.nodes.map((entry) => [entry.id, entry]));
      return {
        kind: 'node',
        id: node.id,
        name: node.name,
        typeId: node.kindId,
        order: node.createdAt.getTime(),
        visible: true,
        target: nodeTarget(node, folderChain(node, nodeById), project),
      };
    }
    return null;
  }

  async writeNumber(
    tx: TransactionClient,
    kind: NumberHostKind,
    id: string,
    fieldId: string,
    display: string,
  ): Promise<void> {
    if (kind === 'node') {
      const node = await this.nodes.findById(id, tx);
      if (!node) return;
      const next = { ...asValues(node.customFields), [fieldId]: display };
      await this.nodes.update(tx, id, { customFields: next as Prisma.InputJsonValue });
      await this.events.emit(
        tx,
        PROJECT_EVENTS.NODE_UPDATED,
        {
          projectId: node.projectId,
          nodeId: node.id,
          fields: [`cf.${fieldId}`],
          customFieldChanges: [{ fieldId, from: null, to: display }],
        },
        { aggregateType: 'project_node', aggregateId: node.id },
      );
      return;
    }
    if (kind === 'project') {
      const project = await this.projects.findById(id, tx);
      if (!project) return;
      const next = { ...asValues(project.customFields), [fieldId]: display };
      await this.projects.update(tx, id, { customFields: next as Prisma.InputJsonValue });
      await this.events.emit(
        tx,
        PROJECT_EVENTS.UPDATED,
        { projectId: id, fields: [`cf.${fieldId}`] },
        { aggregateType: 'project', aggregateId: id },
      );
    }
  }

  async resolveRef(
    tx: TransactionClient,
    hit: NumberContainerHit,
    actor: NumberActor,
  ): Promise<NumberContainerRef | null> {
    if (hit.entity === 'node') {
      const contexts = await this.reader.numberContext([], [hit.id], tx);
      const node = contexts.nodes.find((entry) => entry.id === hit.id);
      if (!node) return null;
      const project = contexts.projects.find((entry) => entry.id === node.projectId);
      const scope = await this.reader.viewScopeFor(actor);
      const hidden = project ? !scope.visibleProjectIds.includes(project.id) : false;
      const nodeById = new Map(contexts.nodes.map((entry) => [entry.id, entry]));
      const path = [...folderPath(node, nodeById)];
      return {
        entity: 'node',
        id: node.id,
        name: hidden ? 'Скрытый проект' : node.name,
        path: hidden ? [] : [...(project ? [project.name] : []), ...path],
        hidden,
        deleted: false,
      };
    }
    if (hit.entity === 'project') {
      const project = await this.projects.findById(hit.id, tx);
      if (!project) return null;
      const scope = await this.reader.viewScopeFor(actor);
      const hidden = !scope.visibleProjectIds.includes(project.id);
      return {
        entity: 'project',
        id: project.id,
        name: hidden ? 'Скрытый проект' : project.name,
        path: [],
        hidden,
        deleted: false,
      };
    }
    if (hit.entity === 'portfolio') {
      const group = (await this.groups.list(true)).find((entry) => entry.id === hit.id);
      return group
        ? {
            entity: 'portfolio',
            id: group.id,
            name: group.name,
            path: [],
            hidden: false,
            deleted: false,
          }
        : null;
    }
    if (hit.entity === 'project_type') {
      const type = await this.types.findById(hit.id, tx);
      return type
        ? {
            entity: 'project_type',
            id: type.id,
            name: type.name,
            path: [],
            hidden: false,
            deleted: false,
          }
        : null;
    }
    return null;
  }

  async countWithoutNumber(
    tx: TransactionClient,
    typeIds: readonly string[],
    fieldId: string,
  ): Promise<number> {
    const ids = [...new Set(typeIds)];
    if (ids.length === 0) return 0;
    const list = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
    const [projects, nodes] = await Promise.all([
      tx.$queryRaw<{ count: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS count FROM projects
        WHERE type_id IN (${list})
          AND (custom_fields->>${fieldId} IS NULL OR custom_fields->>${fieldId} = '')
      `),
      tx.$queryRaw<{ count: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS count FROM project_nodes
        WHERE kind_id IN (${list})
          AND (custom_fields->>${fieldId} IS NULL OR custom_fields->>${fieldId} = '')
      `),
    ]);
    return (projects[0]?.count ?? 0) + (nodes[0]?.count ?? 0);
  }
}

function projectTarget(project: NumberProjectContext): NumberTarget {
  return {
    host: 'project',
    typeId: project.typeId,
    folders: [],
    projectId: null,
    portfolioId: project.portfolioId,
    projectTypeId: project.typeId,
    parentTaskId: null,
    sources: { self: project.values },
  };
}

function nodeTarget(
  node: NumberNodeContext,
  chain: readonly NumberNodeContext[],
  project: NumberProjectContext,
): NumberTarget {
  return {
    host: 'node',
    typeId: node.kindId,
    folders: chain.map((entry) => ({ id: entry.id, kindId: entry.kindId })),
    projectId: project.id,
    portfolioId: project.portfolioId,
    projectTypeId: project.typeId,
    parentTaskId: null,
    sources: {
      self: node.values,
      project: project.values,
      folders: chain.map((entry) => ({ kindId: entry.kindId, values: entry.values })),
    },
  };
}

/** Папки СНАРУЖИ узла от ближайшей вверх (сам узел не входит). */
function folderChain(
  node: NumberNodeContext,
  byId: ReadonlyMap<string, NumberNodeContext>,
): NumberNodeContext[] {
  const chain: NumberNodeContext[] = [];
  let parent = node.parentId ? byId.get(node.parentId) : undefined;
  while (parent) {
    chain.push(parent);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return chain;
}

/** Путь предков от корня вниз (без самого узла). */
function folderPath(
  node: NumberNodeContext,
  byId: ReadonlyMap<string, NumberNodeContext>,
): string[] {
  return folderChain(node, byId)
    .map((entry) => entry.name)
    .reverse();
}

function asValues(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}
