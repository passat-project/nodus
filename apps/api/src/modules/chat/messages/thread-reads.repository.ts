import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Квитанции чтения тредов (#971): «Просмотрено» ответов обсуждения. Пишется
 * ЛЮБЫМ участником беседы, открывшим тред, — не только наблюдателям, поэтому
 * отделено от `thread_participants` (участие = уведомления). Watermark трэда
 * для точки «есть новые» живёт там же, где был (thread-participants).
 */
@Injectable()
export class ThreadReadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: TransactionClient): PrismaService | TransactionClient {
    return tx ?? this.prisma;
  }

  /**
   * GREATEST-watermark чтения треда + время чтения (обновляется и при догоне
   * правок: «Просмотрено» после правки считается по времени чтения треда).
   * Возвращает факт движения — для тихих повторов.
   */
  async advance(
    threadRootId: string,
    userId: string,
    upToSeq: bigint,
    tx?: TransactionClient,
  ): Promise<boolean> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<{ last_read_seq: bigint }[]>(Prisma.sql`
      INSERT INTO thread_reads (thread_root_id, user_id, last_read_seq, last_read_at)
      VALUES (${threadRootId}::uuid, ${userId}::uuid, ${upToSeq.toString()}::bigint, now())
      ON CONFLICT (thread_root_id, user_id) DO UPDATE
      SET last_read_seq = GREATEST(thread_reads.last_read_seq, EXCLUDED.last_read_seq),
          last_read_at = now()
      WHERE thread_reads.last_read_seq < EXCLUDED.last_read_seq
         OR thread_reads.last_read_at IS NULL
         OR EXISTS (
           SELECT 1 FROM messages msg
           WHERE msg.thread_root_id = ${threadRootId}::uuid
             AND msg.author_id <> ${userId}::uuid
             AND msg.deleted_at IS NULL
             AND msg.edited_at IS NOT NULL
             AND msg.edited_at > thread_reads.last_read_at
         )
      RETURNING thread_reads.last_read_seq
    `);
    return rows.length > 0;
  }

  /** Курсоры чтения тредов для квитанций «Просмотрено»: батч по корням
   *  страницы сообщений (пустой результат — ответов без читателей). */
  async readCursorsFor(
    threadRootIds: readonly string[],
  ): Promise<Map<string, { userId: string; lastReadSeq: bigint; lastReadAt: Date | null }[]>> {
    const byRoot = new Map<
      string,
      { userId: string; lastReadSeq: bigint; lastReadAt: Date | null }[]
    >();
    if (threadRootIds.length === 0) return byRoot;
    const rows = await this.prisma.$queryRaw<
      { threadRootId: string; userId: string; lastReadSeq: bigint; lastReadAt: Date | null }[]
    >(Prisma.sql`
      SELECT tr.thread_root_id AS "threadRootId", tr.user_id AS "userId",
             tr.last_read_seq AS "lastReadSeq", tr.last_read_at AS "lastReadAt"
      FROM thread_reads tr
      WHERE tr.thread_root_id = ANY(${threadRootIds}::uuid[])
    `);
    for (const row of rows) {
      const list = byRoot.get(row.threadRootId) ?? [];
      list.push({ userId: row.userId, lastReadSeq: row.lastReadSeq, lastReadAt: row.lastReadAt });
      byRoot.set(row.threadRootId, list);
    }
    return byRoot;
  }
}
