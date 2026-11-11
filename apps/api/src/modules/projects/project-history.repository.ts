import { Injectable } from '@nestjs/common';
import type { ProjectHistoryKind } from '@nodus/contracts';

import { PrismaService } from '../../core/database/prisma.service.js';

const PROJECT_EVENT_KINDS: Record<string, ProjectHistoryKind> = {
  'project.created': 'created',
  'project.updated': 'updated',
  'project.participants_changed': 'participants_changed',
};

/** Строка журнала событий агрегата проекта (outbox, I9). */
export interface ProjectEventRow {
  id: string;
  type: string;
  actorId: string | null;
  payload: unknown;
  createdAt: Date;
  seq: bigint;
}

/**
 * Чтение истории проекта из журнала событий (I9): лента вкладки «История»
 * не заводит своей таблицы — источник истины уже пишется outbox'ом в той же
 * транзакции, что и изменение. Ключ курсора — монотонный `seq` (события
 * одного проекта упорядочены глобальной последовательностью).
 */
@Injectable()
export class ProjectHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Страница событий агрегата (новые первыми), keyset по `seq`.
   *  `minSeq` — нижняя граница видимой ленты (#748): события секретной эпохи
   *  до раскрытия не покидают сервер. */
  async findPage(
    projectId: string,
    after: bigint | null,
    limit: number,
    minSeq: bigint | null = null,
  ): Promise<ProjectEventRow[]> {
    const rows = await this.prisma.event.findMany({
      where: {
        aggregateType: 'project',
        aggregateId: projectId,
        type: { in: Object.keys(PROJECT_EVENT_KINDS) },
        seq: {
          ...(after === null ? {} : { lt: after }),
          ...(minSeq === null ? {} : { gte: minSeq }),
        },
      },
      select: { id: true, type: true, actorId: true, payload: true, createdAt: true, seq: true },
      orderBy: { seq: 'desc' },
      take: limit + 1,
    });
    return rows;
  }

  /**
   * Момент последнего раскрытия проекта — seq события `project.updated`,
   * в котором сменилась видимость (#748). Журнал append-only (I9), поэтому
   * граница секретной эпохи восстанавливается без отдельного маркера и для
   * старых записей; текущее состояние `open` означает, что последняя смена
   * видимости и была раскрытием.
   */
  async findLastVisibilityChangeSeq(projectId: string): Promise<bigint | null> {
    const row = await this.prisma.event.findFirst({
      where: {
        aggregateType: 'project',
        aggregateId: projectId,
        type: 'project.updated',
        payload: { path: ['fields'], array_contains: ['visibility'] },
      },
      select: { seq: true },
      orderBy: { seq: 'desc' },
    });
    return row?.seq ?? null;
  }
}

export { PROJECT_EVENT_KINDS };
