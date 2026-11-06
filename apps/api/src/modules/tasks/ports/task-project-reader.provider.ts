import { Injectable } from '@nestjs/common';
import { statesOfPhase } from '@nodus/contracts';

import { PrismaService } from '../../../core/database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { TaskNodeRollup, TaskProjectReader } from './task-project-reader.port.js';

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
  constructor(private readonly prisma: PrismaService) {}

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
