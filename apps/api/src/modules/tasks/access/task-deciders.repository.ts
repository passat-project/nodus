import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { DeciderTaskRow } from './task-decider-facts.js';

/**
 * Таблицы задач для расчёта решающих (#433): кандидаты в статусах с
 * `decider_in`, минимальная строка задачи, участие и вставка наблюдателя.
 * Prisma — только здесь (patterns.md: repository pattern), сервис работает
 * с данными.
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
        confidential: true,
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
        confidential: true,
        customFields: true,
      },
    }) as Promise<DeciderTaskRow | null>;
  }

  /** Участники задачи (постановщик/ответственный/соисполнители/наблюдатели). */
  async participantIds(taskId: string, tx?: TransactionClient): Promise<string[]> {
    const rows = await (tx ?? this.prisma).taskParticipant.findMany({
      where: { taskId },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /** Есть ли строка участия (для идемпотентного наблюдателя). */
  async findParticipant(tx: TransactionClient, taskId: string, userId: string): Promise<boolean> {
    const row = await tx.taskParticipant.findUnique({
      where: { taskId_userId: { taskId, userId } },
      select: { userId: true },
    });
    return row !== null;
  }

  /** Наблюдатель без звука (#433): только вставка — coexecutor не понижается. */
  async insertObserver(tx: TransactionClient, taskId: string, userId: string): Promise<void> {
    await tx.taskParticipant.create({
      data: { taskId, userId, role: 'observer', muted: true },
    });
  }
}
