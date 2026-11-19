import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Репозиторий участников трэдов (раунд 3): наблюдатели (author | replier |
 * watcher | mentioned) и watermark трэда `thread_participants.last_read_seq`
 * — точка «есть новые» на посте канала. Выделен из MessagesRepository
 * (I5: агрегат сообщений перерос 500 строк).
 */
@Injectable()
export class ThreadParticipantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: TransactionClient): PrismaService | TransactionClient {
    return tx ?? this.prisma;
  }

  /** Участник треда (уведомления — только им; заполняется с первого ответа).
   *  source: author | replier | watcher (кнопка «Следить») | mentioned (@). */
  async upsert(
    threadRootId: string,
    userId: string,
    source: 'author' | 'replier' | 'watcher' | 'mentioned',
    tx: TransactionClient,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO thread_participants (thread_root_id, user_id, source)
      VALUES (${threadRootId}::uuid, ${userId}::uuid, ${source})
      ON CONFLICT DO NOTHING
    `);
  }

  /** Снять наблюдение кнопкой: удаляет строку участия (реплай/@ добавят
   *  снова; автор корня вернётся кнопкой «Следить»). */
  async delete(threadRootId: string, userId: string, tx: TransactionClient): Promise<boolean> {
    const count = await tx.$executeRaw(Prisma.sql`
      DELETE FROM thread_participants
      WHERE thread_root_id = ${threadRootId}::uuid AND user_id = ${userId}::uuid
    `);
    return count > 0;
  }

  /** Watermark трэда наблюдателя (null — не участник). */
  async findLastRead(
    threadRootId: string,
    userId: string,
    tx?: TransactionClient,
  ): Promise<bigint | null> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<{ last_read_seq: bigint }[]>(Prisma.sql`
      SELECT last_read_seq FROM thread_participants
      WHERE thread_root_id = ${threadRootId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1
    `);
    return rows[0]?.last_read_seq ?? null;
  }

  /** Квитанция из треда (раунд 3): GREATEST-watermark трэда участника
   *  (не-участнику писать нечего — точка ему не показывается). Возвращает факт
   *  движения (для решения об инвалидациях клиента достаточно события
   *  беседы; тихие повторы не дёргают список). Квитанции «Просмотрено»
   *  ответов живут в ThreadReadsRepository (#971). */
  async advanceReadCursor(
    threadRootId: string,
    userId: string,
    upToSeq: bigint,
    tx: TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ last_read_seq: bigint }[]>(Prisma.sql`
      UPDATE thread_participants tp
      SET last_read_seq = GREATEST(tp.last_read_seq, ${upToSeq.toString()}::bigint)
      WHERE tp.thread_root_id = ${threadRootId}::uuid AND tp.user_id = ${userId}::uuid
        AND tp.last_read_seq < ${upToSeq.toString()}::bigint
      RETURNING tp.last_read_seq
    `);
    return rows.length > 0;
  }

  /** Состояния трэдов беседы для текущего пользователя (раунд 3): строка на
   *  каждый трэд, где он участник (author/replier/watcher/mentioned); чужие
   *  ответы выше watermark — непрочитанные (точка на посте). */
  async states(
    conversationId: string,
    userId: string,
  ): Promise<{ threadRootId: string; watched: true; unreadCount: number }[]> {
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT tp.thread_root_id AS "threadRootId", true AS "watched",
        (SELECT COUNT(*)::int FROM messages r
          WHERE r.thread_root_id = tp.thread_root_id
            AND r.deleted_at IS NULL
            AND NOT r.obliterated
            AND r.author_id <> ${userId}::uuid
            AND r.seq > tp.last_read_seq) AS "unreadCount"
      FROM thread_participants tp
      JOIN messages root ON root.id = tp.thread_root_id
        AND root.conversation_id = ${conversationId}::uuid
      WHERE tp.user_id = ${userId}::uuid
    `);
  }
}
