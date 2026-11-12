import { Injectable } from '@nestjs/common';
import { statesOfPhase } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import { TASK_EVENTS } from '@nodus/contracts';
import { Prisma } from '../../../generated/prisma/client.js';
import { audienceIds } from '../access/task-access.js';
import type { DeciderTaskRow } from '../access/task-decider-facts.js';
import { TaskDeciderRecipients } from '../access/task-decider-recipients.service.js';
import type {
  ProjectTaskHolder,
  ProjectTaskHolderRole,
  ProjectTaskStaffing,
  TaskNodeRollup,
  TaskProjectReader,
} from './task-project-reader.port.js';

/** Строка сырого агрегата узла (даты — timestamptz). */
interface RollupRow {
  node_id: string;
  task_count: number;
  done_count: number;
  planned_minutes: number;
  spent_minutes: number;
  nearest_deadline: Date | null;
  latest_deadline: Date | null;
}

/**
 * Реализация read-порта TaskProjectReader: доступ к таблицам задач —
 * только здесь (I3/I6); наблюдатели задач в состав проекта не попадают
 * (вердикт 29.10 — зеркало involves() без participants-наблюдателей).
 */
@Injectable()
export class TaskProjectReaderProvider implements TaskProjectReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deciders: TaskDeciderRecipients,
    private readonly events: EventBus,
  ) {}

  async membersOf(projectId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT u.user_id FROM (
        SELECT creator_id AS user_id FROM tasks
        WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
        UNION
        SELECT assignee_id AS user_id FROM tasks
        WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
        UNION
        SELECT tp.user_id FROM task_participants tp
        JOIN tasks t ON t.id = tp.task_id
        WHERE t.project_id = ${projectId}::uuid AND t.deleted_at IS NULL
          AND tp.role = 'coexecutor'
      ) u
    `;
    return rows.map((row) => row.user_id);
  }

  async roleHolderIds(projectId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT u.user_id FROM (
        SELECT creator_id AS user_id FROM tasks
        WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
        UNION
        SELECT assignee_id AS user_id FROM tasks
        WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
        UNION
        SELECT tp.user_id FROM task_participants tp
        JOIN tasks t ON t.id = tp.task_id
        WHERE t.project_id = ${projectId}::uuid AND t.deleted_at IS NULL
      ) u
    `;
    return rows.map((row) => row.user_id);
  }

  async staffingOf(
    projectId: string,
    opts: { viewerId?: string; tx?: TransactionClient } = {},
  ): Promise<ProjectTaskStaffing> {
    const [holders, observers, tasks] = await Promise.all([
      this.holdersOf(projectId, opts),
      this.observersOf(projectId, opts),
      this.deciderCandidatesOf(projectId, opts),
    ]);
    const holderIds = new Set(holders.map((holder) => holder.userId));
    const deciderIds = new Set<string>();
    for (const task of tasks) {
      const ids = await this.deciders.idsForStage(opts.tx, task, {
        id: task.stageId,
        systemState: task.systemState,
      });
      for (const id of ids) if (!holderIds.has(id)) deciderIds.add(id);
    }
    return { holders, deciderIds: [...deciderIds], observers };
  }

  async detachObservers(
    tx: TransactionClient,
    projectId: string,
    userIds: readonly string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    const rows = await tx.taskParticipant.findMany({
      where: {
        role: 'observer',
        userId: { in: [...userIds] },
        task: { projectId, deletedAt: null },
      },
      select: { taskId: true, userId: true },
    });
    if (rows.length === 0) return;
    const byTask = new Map<string, string[]>();
    for (const row of rows) {
      byTask.set(row.taskId, [...(byTask.get(row.taskId) ?? []), row.userId]);
    }
    await tx.taskParticipant.deleteMany({
      where: {
        role: 'observer',
        userId: { in: [...userIds] },
        task: { projectId, deletedAt: null },
      },
    });
    // Событие по каждой задаче: канал задачи пересобирает состав (снятый не
    // читает чат/файлы), purge уведомлений и история задачи срабатывают
    // штатными обработчиками `task.participants_changed` (#541, security).
    const tasks = await tx.task.findMany({
      where: { id: { in: [...byTask.keys()] } },
      select: {
        id: true,
        number: true,
        title: true,
        projectId: true,
        creatorId: true,
        assigneeId: true,
        participants: { select: { userId: true, role: true } },
      },
    });
    for (const task of tasks) {
      const removed = [...new Set(byTask.get(task.id) ?? [])];
      await this.events.emit(
        tx,
        TASK_EVENTS.PARTICIPANTS_CHANGED,
        {
          taskId: task.id,
          number: task.number,
          title: task.title,
          projectId: task.projectId,
          audience: audienceIds(task, removed),
          added: [],
          removed,
        },
        { actorId: null, aggregateType: 'task', aggregateId: task.id },
      );
    }
  }

  /** Фильтр конфиденциальных задач для превью (#461): чужую конфиденциальную
   *  задачу не раскрывает даже руководству проекта. При конвертации
   *  (`viewerId` нет) фильтр пуст — держатели ролей не теряют работу. */
  private confidentialFilter(viewerId: string | undefined, alias: 'tasks' | 't'): Prisma.Sql {
    if (!viewerId) return Prisma.empty;
    const table = Prisma.raw(alias);
    return Prisma.sql`AND (${table}.confidential = false
      OR ${table}.creator_id = ${viewerId}::uuid
      OR ${table}.assignee_id = ${viewerId}::uuid
      OR EXISTS (SELECT 1 FROM task_participants vp
                 WHERE vp.task_id = ${table}.id AND vp.user_id = ${viewerId}::uuid))`;
  }

  /** Носители ролей задач проекта: роли и число задач на человека (#541). */
  private async holdersOf(
    projectId: string,
    opts: { viewerId?: string; tx?: TransactionClient },
  ): Promise<ProjectTaskHolder[]> {
    const db = opts.tx ?? this.prisma;
    const byTasks = this.confidentialFilter(opts.viewerId, 'tasks');
    const byT = this.confidentialFilter(opts.viewerId, 't');
    const rows = await db.$queryRaw<
      {
        user_id: string;
        is_creator: boolean;
        is_assignee: boolean;
        is_coexecutor: boolean;
        task_count: number;
      }[]
    >`
      SELECT user_id,
             BOOL_OR(is_creator) AS is_creator,
             BOOL_OR(is_assignee) AS is_assignee,
             BOOL_OR(is_coexecutor) AS is_coexecutor,
             COUNT(DISTINCT task_id)::int AS task_count
      FROM (
        SELECT id AS task_id, creator_id AS user_id, TRUE AS is_creator,
               FALSE AS is_assignee, FALSE AS is_coexecutor
        FROM tasks WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
          ${byTasks}
        UNION ALL
        SELECT id, assignee_id, FALSE, TRUE, FALSE
        FROM tasks WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
          ${byTasks}
        UNION ALL
        SELECT t.id, tp.user_id, FALSE, FALSE, TRUE
        FROM task_participants tp
        JOIN tasks t ON t.id = tp.task_id
        WHERE t.project_id = ${projectId}::uuid AND t.deleted_at IS NULL
          AND tp.role = 'coexecutor'
          ${byT}
      ) u
      GROUP BY user_id
    `;
    return rows.map((row) => {
      const roles: ProjectTaskHolderRole[] = [];
      if (row.is_creator) roles.push('creator');
      if (row.is_assignee) roles.push('assignee');
      if (row.is_coexecutor) roles.push('coexecutor');
      return { userId: row.user_id, roles, taskCount: row.task_count };
    });
  }

  /** Наблюдатели задач проекта с числом задач (#541). */
  private async observersOf(
    projectId: string,
    opts: { viewerId?: string; tx?: TransactionClient },
  ): Promise<{ userId: string; taskCount: number }[]> {
    const db = opts.tx ?? this.prisma;
    const filter = this.confidentialFilter(opts.viewerId, 't');
    const rows = await db.$queryRaw<{ user_id: string; task_count: number }[]>`
      SELECT tp.user_id, COUNT(DISTINCT t.id)::int AS task_count
      FROM task_participants tp
      JOIN tasks t ON t.id = tp.task_id
      WHERE t.project_id = ${projectId}::uuid AND t.deleted_at IS NULL
        AND tp.role = 'observer'
        ${filter}
      GROUP BY tp.user_id
    `;
    return rows.map((row) => ({ userId: row.user_id, taskCount: row.task_count }));
  }

  /** Живые задачи проекта для расчёта решающих: все, keyset-пачками (без
   *  «тихого» лимита — иначе решающий по старой задаче теряет кнопку). */
  private async deciderCandidatesOf(
    projectId: string,
    opts: { viewerId?: string; tx?: TransactionClient },
  ): Promise<DeciderTaskRow[]> {
    const db = opts.tx ?? this.prisma;
    const where = {
      projectId,
      deletedAt: null,
      ...(opts.viewerId
        ? {
            OR: [
              { confidential: false },
              { creatorId: opts.viewerId },
              { assigneeId: opts.viewerId },
              { participants: { some: { userId: opts.viewerId } } },
            ],
          }
        : {}),
    };
    const all: DeciderTaskRow[] = [];
    let cursor: string | null = null;
    for (;;) {
      const batch = (await db.task.findMany({
        where: cursor ? { ...where, id: { gt: cursor } } : where,
        select: {
          id: true,
          workflowId: true,
          stageId: true,
          systemState: true,
          creatorId: true,
          assigneeId: true,
          projectId: true,
          confidential: true,
          customFields: true,
        },
        orderBy: { id: 'asc' },
        take: 500,
      })) as DeciderTaskRow[];
      all.push(...batch);
      if (batch.length < 500) break;
      cursor = batch[batch.length - 1]!.id;
    }
    return all;
  }

  async projectIdOf(taskId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ project_id: string | null }[]>`
      SELECT project_id FROM tasks
      WHERE id = ${taskId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0]?.project_id ?? null;
  }

  async nodeRollups(projectId: string): Promise<TaskNodeRollup[]> {
    // Прямые задачи узлов проекта одним GROUP BY (#467). Завершённость —
    // канон isCompletedState: закрытая стадия && outcome не cancelled/rejected
    // (#430); исход стадии — в workflow_stages (tasks денормализуют только state).
    // nearest — MIN(deadline) фазы open (backlog/active/paused — канон
    // statesOfPhase('open')), latest — MAX(deadline) всех задач узла.
    const rows = await this.prisma.$queryRaw<RollupRow[]>`
      SELECT n.id AS node_id,
             COUNT(t.id)::int AS task_count,
             (COUNT(*) FILTER (
               WHERE ws.system_state = 'closed'
                 AND ws.outcome IS DISTINCT FROM 'cancelled'
                 AND ws.outcome IS DISTINCT FROM 'rejected'
             ))::int AS done_count,
             COALESCE(SUM(t.planned_minutes), 0)::int AS planned_minutes,
             COALESCE(SUM(t.spent_minutes), 0)::int AS spent_minutes,
             MIN(t.deadline) FILTER (
               WHERE ws.system_state IN (${Prisma.join(statesOfPhase('open'))})
             ) AS nearest_deadline,
             MAX(t.deadline) AS latest_deadline
      FROM project_nodes n
      LEFT JOIN tasks t ON t.node_id = n.id AND t.deleted_at IS NULL
      LEFT JOIN workflow_stages ws ON ws.id = t.stage_id
      WHERE n.project_id = ${projectId}::uuid
      GROUP BY n.id
    `;
    return rows.map((row) => ({
      nodeId: row.node_id,
      taskCount: row.task_count,
      doneCount: row.done_count,
      plannedMinutes: row.planned_minutes,
      spentMinutes: row.spent_minutes,
      nearestDeadline: row.nearest_deadline?.toISOString() ?? null,
      latestDeadline: row.latest_deadline?.toISOString() ?? null,
    }));
  }

  async hasNodeTasks(projectId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ has: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM tasks t
        JOIN project_nodes n ON n.id = t.node_id
        WHERE n.project_id = ${projectId}::uuid AND t.deleted_at IS NULL
      ) AS has
    `;
    return rows[0]?.has === true;
  }

  async taskIdsInNodes(
    projectId: string,
    nodeIds: readonly string[],
    actorId?: string,
  ): Promise<string[]> {
    if (nodeIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM tasks
      WHERE project_id = ${projectId}::uuid
        AND deleted_at IS NULL
        AND node_id IN (${Prisma.join(nodeIds.map((id) => Prisma.sql`${id}::uuid`))})
        ${
          actorId
            ? Prisma.sql`AND (
                confidential = false
                OR creator_id = ${actorId}::uuid
                OR assignee_id = ${actorId}::uuid
                OR EXISTS (
                  SELECT 1 FROM task_participants tp
                  WHERE tp.task_id = tasks.id AND tp.user_id = ${actorId}::uuid
                )
              )`
            : Prisma.empty
        }
    `;
    return rows.map((row) => row.id);
  }
}
