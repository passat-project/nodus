import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

type Round = Awaited<ReturnType<PressRepository['findOpenRound']>>;

/**
 * Хранилище раунда сбора (#434). Раунд принадлежит модулю задач (карточка
 * «Статусы участников», видимость ожидающих); настройка кнопки приходит из
 * read-порта «Процессов». Все мутации — в транзакции вызывающего, которая
 * держит FOR UPDATE строки задачи (сериализация последних нажатий).
 */
@Injectable()
export class PressRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOpenRound(tx: TransactionClient | undefined, entityKind: string, entityId: string) {
    return (tx ?? this.prisma).pressRound.findFirst({
      where: { entityKind, entityId, completedAt: null, cancelledAt: null },
      include: { entries: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    });
  }

  async findOpenRoundId(
    tx: TransactionClient | undefined,
    entityKind: string,
    entityId: string,
  ) {
    return (tx ?? this.prisma).pressRound.findFirst({
      where: { entityKind, entityId, completedAt: null, cancelledAt: null },
      select: { id: true },
    });
  }

  createRound(
    tx: TransactionClient,
    data: {
      entityKind: string;
      entityId: string;
      stageId: string;
      transitionId: string;
      transitionName: string;
      cycle: number;
      config: object;
      form: object;
      entries: { userId: string; order: number }[];
    },
  ) {
    return tx.pressRound.create({
      data: {
        entityKind: data.entityKind,
        entityId: data.entityId,
        stageId: data.stageId,
        transitionId: data.transitionId,
        transitionName: data.transitionName,
        cycle: data.cycle,
        config: data.config,
        form: data.form,
        entries: { create: data.entries },
      },
      include: { entries: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    });
  }

  findEntry(tx: TransactionClient, roundId: string, userId: string) {
    return tx.pressEntry.findUnique({ where: { roundId_userId: { roundId, userId } } });
  }

  updateEntry(
    tx: TransactionClient,
    entryId: string,
    data: {
      state?: string;
      pressedAt?: Date | null;
      input?: Prisma.InputJsonValue | null;
      result?: Prisma.InputJsonValue | null;
      timeEntryId?: string | null;
      returnReason?: string | null;
    },
  ) {
    const { input, result, ...rest } = data;
    return tx.pressEntry.update({
      where: { id: entryId },
      data: {
        ...rest,
        ...(input === undefined
          ? {}
          : { input: input === null ? Prisma.DbNull : input }),
        ...(result === undefined
          ? {}
          : { result: result === null ? Prisma.DbNull : result }),
      },
    });
  }

  completeRound(tx: TransactionClient, roundId: string, at: Date) {
    return tx.pressRound.update({
      where: { id: roundId },
      data: { completedAt: at },
    });
  }

  cancelOpenRound(tx: TransactionClient, entityKind: string, entityId: string, at: Date) {
    return tx.pressRound.updateMany({
      where: { entityKind, entityId, completedAt: null, cancelledAt: null },
      data: { cancelledAt: at },
    });
  }

  /** Задачи, где у сотрудника есть отметка сбора — ветка видимости карточки
   *  (аналог решающих, #433). Нажавший остаётся зрителем и после кворума:
   *  он открывает «Статусы участников» и видит итог. */
  async waitingTaskIds(userId: string, tx?: TransactionClient): Promise<string[]> {
    const rows = await (tx ?? this.prisma).pressEntry.findMany({
      where: {
        userId,
        state: { in: ['waiting', 'returned', 'pressed', 'withdrawn'] },
      },
      select: { round: { select: { entityId: true } } },
    });
    return [...new Set(rows.map((row) => row.round.entityId))];
  }

  async nextCycle(tx: TransactionClient, entityKind: string, entityId: string): Promise<number> {
    const last = await tx.pressRound.findFirst({
      where: { entityKind, entityId },
      orderBy: { cycle: 'desc' },
      select: { cycle: true },
    });
    return (last?.cycle ?? 0) + 1;
  }
}

export type PressRoundRow = NonNullable<Round>;
