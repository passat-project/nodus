import { Inject, Injectable } from '@nestjs/common';
import {
  TASK_EVENTS,
  type NumberContainerHit,
  type NumberContainerRef,
  type NumberHostKind,
} from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { audienceIds } from '../access/task-access.js';
import { ViewerResolver, visibleTasksWhere } from '../access/task-visibility.js';
import { TasksQueryRepository } from '../tasks/tasks-query.repository.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import {
  PROJECT_READER,
  type NumberNodeContext,
  type NumberProjectContext,
  type ProjectReader,
} from '../../projects/ports/project-reader.port.js';
import type {
  NumberActor,
  NumberHostProvider,
  NumberHostRecord,
  NumberTarget,
} from '../../custom-fields/ports/number-host.port.js';

/**
 * Носитель номеров «задача» (#630): место — папки снаружи, проект, портфель,
 * родительская задача; значения источников — задача, проект, родитель,
 * папки. Видимость — те же правила, что у списка задач (секретные проекты,
 * конфиденциальные задачи).
 */
@Injectable()
export class TaskNumberHostProvider implements NumberHostProvider {
  static readonly numberHostKinds: readonly NumberHostKind[] = ['task'];
  readonly numberHostKinds = TaskNumberHostProvider.numberHostKinds;

  constructor(
    private readonly query: TasksQueryRepository,
    private readonly tasks: TasksRepository,
    private readonly viewer: ViewerResolver,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    private readonly events: EventBus,
  ) {}

  async listHosts(
    tx: TransactionClient,
    actor: NumberActor,
    typeIds: readonly string[],
  ): Promise<NumberHostRecord[]> {
    const rows = await this.query.listNumberHosts(typeIds, tx);
    if (rows.length === 0) return [];
    const contexts = await this.readerContext(tx, rows);
    const viewer = await this.viewer.resolve(actor);
    const visible = await this.query.numberHostVisibleIds(
      rows.map((row) => row.id),
      visibleTasksWhere(viewer, 'all'),
      tx,
    );
    return rows.map((row) => ({
      kind: 'task',
      id: row.id,
      name: row.title,
      typeId: row.typeId,
      order: row.number,
      visible: visible.has(row.id),
      target: taskNumberTarget(row, contexts),
    }));
  }

  async findHost(
    tx: TransactionClient,
    actor: NumberActor,
    kind: NumberHostKind,
    id: string,
  ): Promise<NumberHostRecord | null> {
    if (kind !== 'task') return null;
    const row = await this.query.numberHostById(id, tx);
    if (!row) return null;
    const viewer = await this.viewer.resolve(actor);
    const visible = await this.query.numberHostVisibleIds(
      [row.id],
      visibleTasksWhere(viewer, 'all'),
      tx,
    );
    if (!visible.has(row.id)) return null;
    const contexts = await this.readerContext(tx, [row]);
    return {
      kind: 'task',
      id: row.id,
      name: row.title,
      typeId: row.typeId,
      order: row.number,
      visible: true,
      target: taskNumberTarget(row, contexts),
    };
  }

  async writeNumber(
    tx: TransactionClient,
    kind: NumberHostKind,
    id: string,
    fieldId: string,
    display: string,
  ): Promise<void> {
    if (kind !== 'task') return;
    const task = await this.tasks.findWithParticipants(id, tx);
    const next = { ...asValues(task.customFields), [fieldId]: display };
    await this.tasks.updateFields(tx, id, { customFields: next as never });
    await this.events.emit(
      tx,
      TASK_EVENTS.UPDATED,
      {
        taskId: task.id,
        number: task.number,
        audience: audienceIds(task),
        fields: [`cf.${fieldId}`],
        customFieldChanges: [{ fieldId, from: null, to: display }],
      },
      { aggregateType: 'task', aggregateId: task.id },
    );
  }

  async resolveRef(
    tx: TransactionClient,
    hit: NumberContainerHit,
    actor: NumberActor,
  ): Promise<NumberContainerRef | null> {
    if (hit.entity !== 'task') return null;
    const row = await this.query.numberHostById(hit.id, tx);
    if (!row) return null;
    const viewer = await this.viewer.resolve(actor);
    const visible = await this.query.numberHostVisibleIds(
      [row.id],
      visibleTasksWhere(viewer, 'all'),
      tx,
    );
    const hidden = !visible.has(row.id);
    return {
      entity: 'task',
      id: row.id,
      name: hidden ? 'Скрытая задача' : row.title,
      path: [],
      hidden,
      deleted: false,
    };
  }

  async countWithoutNumber(
    tx: TransactionClient,
    typeIds: readonly string[],
    fieldId: string,
  ): Promise<number> {
    const ids = [...new Set(typeIds)];
    if (ids.length === 0) return 0;
    const list = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM tasks
      WHERE type_id IN (${list})
        AND deleted_at IS NULL
        AND (custom_fields->>${fieldId} IS NULL OR custom_fields->>${fieldId} = '')
    `);
    return rows[0]?.count ?? 0;
  }

  private async readerContext(
    tx: TransactionClient,
    rows: readonly {
      nodeId: string | null;
      projectId: string | null;
      parentId: string | null;
    }[],
  ): Promise<TaskNumberContext> {
    const projectIds = rows.flatMap((row) => (row.projectId ? [row.projectId] : []));
    const nodeIds = rows.flatMap((row) => (row.nodeId ? [row.nodeId] : []));
    const parentIds = rows.flatMap((row) => (row.parentId ? [row.parentId] : []));
    const [contexts, parentValues] = await Promise.all([
      this.projects.numberContext(projectIds, nodeIds, tx),
      this.query.customFieldsOf(parentIds, tx),
    ]);
    return {
      projects: new Map(contexts.projects.map((project) => [project.id, project])),
      nodes: new Map(contexts.nodes.map((node) => [node.id, node])),
      parents: new Map([...parentValues].map(([id, values]) => [id, asValues(values)] as const)),
    };
  }
}

export function taskNumberTarget(
  row: {
    typeId: string;
    nodeId: string | null;
    projectId: string | null;
    parentId: string | null;
    customFields: unknown;
  },
  context: TaskNumberContext,
): NumberTarget {
  const project = row.projectId ? context.projects.get(row.projectId) : undefined;
  const chain = row.nodeId ? folderChain(context.nodes.get(row.nodeId), context.nodes) : [];
  return {
    host: 'task',
    typeId: row.typeId,
    folders: chain.map((node) => ({ id: node.id, kindId: node.kindId })),
    projectId: project?.id ?? null,
    portfolioId: project?.portfolioId ?? null,
    projectTypeId: project?.typeId ?? null,
    parentTaskId: row.parentId,
    sources: {
      self: asValues(row.customFields),
      project: project?.values ?? null,
      parentTask: row.parentId ? (context.parents.get(row.parentId) ?? null) : null,
      folders: chain.map((node) => ({ kindId: node.kindId, values: node.values })),
    },
  };
}

export interface TaskNumberContext {
  projects: Map<string, NumberProjectContext>;
  nodes: Map<string, NumberNodeContext>;
  parents: Map<string, Record<string, unknown>>;
}

function folderChain(
  node: NumberNodeContext | undefined,
  byId: ReadonlyMap<string, NumberNodeContext>,
): NumberNodeContext[] {
  const chain: NumberNodeContext[] = [];
  let current = node;
  while (current) {
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

function asValues(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}
