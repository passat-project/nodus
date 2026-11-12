import { Injectable } from '@nestjs/common';
import { statesOfPhase } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
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

  async staffingOf(projectId: string): Promise<ProjectTaskStaffing> {
    const [holders, observers, tasks] = await Promise.all([
      this.holdersOf(projectId),
      this.observersOf(projectId),
      this.deciderCandidatesOf(projectId),
    ]);
    const holderIds = new Set(holders.map((holder) => holder.userId));
    const deciderIds = new Set<string>();
    for (const task of tasks) {
      const ids = await this.deciders.idsForStage(undefined, task, {
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
    await tx.taskParticipant.deleteMany({
      where: {
        role: 'observer',
        userId: { in: [...userIds] },
        task: { projectId, deletedAt: null },
      },
    });
  }

  /** Носители ролей задач проекта: роли и число задач на человека (#541). */
  private async holdersOf(projectId: string): Promise<ProjectTaskHolder[]> {
    const rows = await this.prisma.$queryRaw<
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
        UNION ALL
        SELECT id, assignee_id, FALSE, TRUE, FALSE
        FROM tasks WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
        UNION ALL
        SELECT t.id, tp.user_id, FALSE, FALSE, TRUE
        FROM task_participants tp
        JOIN tasks t ON t.id = tp.task_id
        WHERE t.project_id = ${projectId}::uuid AND t.deleted_at IS NULL
          AND tp.role = 'coexecutor'
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
  private async observersOf(projectId: string): Promise<{ userId: string; taskCount: number }[]> {
    const rows = await this.prisma.$queryRaw<{ user_id: string; task_count: number }[]>`
      SELECT tp.user_id, COUNT(DISTINCT t.id)::int AS task_count
      FROM task_participants tp
      JOIN tasks t ON t.id = tp.task_id
      WHERE t.project_id = ${projectId}::uuid AND t.deleted_at IS NULL
        AND tp.role = 'observer'
      GROUP BY tp.user_id
    `;
    return rows.map((row) => ({ userId: row.user_id, taskCount: row.task_count }));
  }

  /** Живые задачи проекта для расчёта решающих с ожидающим действием. */
  private deciderCandidatesOf(projectId: string): Promise<DeciderTaskRow[]> {
    return this.prisma.task.findMany({
      where: { projectId, deletedAt: null },
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
      orderBy: { number: 'desc' },
      take: 2000,
    }) as Promise<DeciderTaskRow[]>;
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
