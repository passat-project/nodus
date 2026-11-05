import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { DeciderTaskRow } from './task-deciders.service.js';

/**
 * Таблицы задач для расчёта решающих (#433): кандидаты в статусах с
 * `decider_in`, минимальная строка задачи и живые сотрудники. Prisma —
 * только здесь (patterns.md: repository pattern), сервис работает с данными.
 */
@Injectable()
export class TaskDecidersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Предохранитель выборки видимости (больше — проекция #438). */
  static readonly MAX_TASKS = 5000;

  /** Задачи маршрутов с `decider_in`: статусы переходов либо все (catch-all). */
  findCandidates(
    workflowIds: readonly string[],
    stageIds: readonly string[],
    catchAll: boolean,
  ): Promise<DeciderTaskRow[]> {
    return this.prisma.task.findMany({
      where: {
        deletedAt: null,
        workflowId: { in: [...workflowIds] },
        ...(catchAll ? {} : { stageId: { in: [...stageIds] } }),
      },
      select: {
        id: true,
        workflowId: true,
        stageId: true,
        systemState: true,
        creatorId: true,
        assigneeId: true,
        projectId: true,
        customFields: true,
      },
      take: TaskDecidersRepository.MAX_TASKS,
      orderBy: { number: 'desc' },
    }) as Promise<DeciderTaskRow[]>;
  }

  /** Минимум живой задачи для проверки «решающий ли» (#433). */
  findTask(taskId: string): Promise<DeciderTaskRow | null> {
    return this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      select: {
        id: true,
        workflowId: true,
        stageId: true,
        systemState: true,
        creatorId: true,
        assigneeId: true,
        projectId: true,
        customFields: true,
      },
    }) as Promise<DeciderTaskRow | null>;
  }

  /** Живые сотрудники из набора (вакантность источников и адресаты). */
  async activeUserIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] }, status: 'active' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}
