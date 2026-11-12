import { Injectable } from '@nestjs/common';
import { TASK_EVENTS } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { audienceIds } from '../access/task-access.js';
import type { DeciderTaskRow } from '../access/task-decider-facts.js';
import { TaskDeciderRecipients } from '../access/task-decider-recipients.service.js';
import type {
  ProjectTaskHolder,
  ProjectTaskHolderRole,
  ProjectTaskStaffing,
} from './task-project-reader.port.js';

/**
 * Снимок ролей задач проекта для перевода в секретный (#541): вынесено из
 * TaskProjectReaderProvider ради лимита файла (I5). Тот же владелец таблиц
 * задач — модуль tasks (I3/I6); наружу отдаётся через порт
 * TASK_PROJECT_READER (делегирование — в reader-провайдере).
 */
@Injectable()
export class ProjectStaffingProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deciders: TaskDeciderRecipients,
    private readonly events: EventBus,
  ) {}

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
}
