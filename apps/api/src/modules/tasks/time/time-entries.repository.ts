import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Трудозатраты (`time_entries`, I14): ручные записи и таймер. Идущий таймер —
 * method=timer, ended_at NULL; один на сотрудника — частичный unique в
 * миграции. spentMinutes задачи = сумма закрытых записей (идущий не в счёт).
 */
@Injectable()
export class TimeEntriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Записи задачи, свежие первыми; keyset (createdAt, id) DESC. */
  pageByTask(taskId: string, after: { t: Date; id: string } | undefined, limit: number) {
    return this.prisma.timeEntry.findMany({
      where: {
        taskId,
        ...(after
          ? {
              OR: [{ createdAt: { lt: after.t } }, { createdAt: after.t, id: { lt: after.id } }],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  findById(id: string) {
    return this.prisma.timeEntry.findUnique({ where: { id } });
  }

  createManual(
    tx: TransactionClient,
    data: {
      taskId: string;
      projectId: string | null;
      userId: string;
      minutes: number;
      date: Date;
      comment: string | null;
    },
  ) {
    return tx.timeEntry.create({ data: { ...data, method: 'manual' } });
  }

  createTimer(
    tx: TransactionClient,
    data: { taskId: string; projectId: string | null; userId: string; date: Date; startedAt: Date },
  ) {
    return tx.timeEntry.create({ data: { ...data, method: 'timer' } });
  }

  async delete(tx: TransactionClient, id: string) {
    return tx.timeEntry.delete({ where: { id } });
  }

  findByIdInTx(tx: TransactionClient, id: string) {
    return tx.timeEntry.findUnique({ where: { id } });
  }

  /** Идущий таймер сотрудника (внутри tx старта/остановки). */
  findRunningTimer(userId: string, tx: TransactionClient) {
    return tx.timeEntry.findFirst({ where: { userId, method: 'timer', endedAt: null } });
  }

  /** Идущий таймер с задачей — виджет «таймер идёт» (вне tx). */
  findRunningTimerWithTask(userId: string) {
    return this.prisma.timeEntry.findFirst({
      where: { userId, method: 'timer', endedAt: null },
      include: { task: { select: { id: true, number: true, title: true } } },
    });
  }

  async closeTimer(
    tx: TransactionClient,
    id: string,
    endedAt: Date,
    minutes: number,
  ): Promise<void> {
    await tx.timeEntry.update({ where: { id }, data: { endedAt, minutes } });
  }

  /** Пересчёт spentMinutes задачи в той же tx; задача с участниками (аудитория). */
  async recalcSpentMinutes(tx: TransactionClient, taskId: string) {
    const agg = await tx.timeEntry.aggregate({
      where: { taskId, NOT: { method: 'timer', endedAt: null } },
      _sum: { minutes: true },
    });
    return tx.task.update({
      where: { id: taskId },
      data: { spentMinutes: agg._sum.minutes ?? 0 },
      include: { participants: true },
    });
  }
}
