import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Прочитанность беседы — два курсора участника (#102 раунд 2, #971):
 *
 * - КУРСОР БЕСЕДЫ `conversation_members.last_read_seq/last_read_at` — бейдж
 *   непрочитанного: двигают и квитанции ленты, и квитанции треда («увидел
 *   где угодно = просмотрено»).
 * - КУРСОР ЛЕНТЫ `last_feed_read_seq/last_feed_read_at` — квитанции
 *   «Просмотрено» сообщений ленты/постов канала: двигают ТОЛЬКО квитанции
 *   ленты (POST /read без `threadRootId`), чтение обсуждения его не трогает
 *   (иначе сотрудник, читавший тред, числился просмотревшим ленту, #971).
 *
 * Watermark треда — thread-participants.repository. Выделен из
 * MessagesRepository (I5).
 */
@Injectable()
export class MessagesReadStateRepository {
  /**
   * Продвижение watermark прочтения: seq монотонно (GREATEST — stale-устройство
   * не откатит), время чтения обновляется и при догоне правок (иначе readAt
   * «повторного прочтения» после edit никогда не восстановится — курсор уже
   * был впереди). `feed` — квитанция из ленты: двигает и курсор ленты.
   * Возвращает факт изменения (любой из курсоров) и фактическое время чтения
   * (для payload события — не now() на эмите).
   */
  async advanceReadCursor(
    conversationId: string,
    userId: string,
    upToSeq: bigint,
    tx: TransactionClient,
    { feed }: { feed: boolean },
  ): Promise<{ advanced: boolean; lastReadAt: Date | null }> {
    const seq = upToSeq.toString();
    const rows = await tx.$queryRaw<{ last_read_seq: bigint; last_read_at: Date }[]>(Prisma.sql`
      UPDATE conversation_members m
      SET last_read_seq = GREATEST(m.last_read_seq, ${seq}::bigint),
          last_read_at = now(),
          updated_at = now()
      WHERE m.conversation_id = ${conversationId}::uuid AND m.user_id = ${userId}::uuid
        AND (m.last_read_seq < ${seq}::bigint
             OR m.last_read_at IS NULL
             OR EXISTS (
               SELECT 1 FROM messages msg
               WHERE msg.conversation_id = ${conversationId}::uuid
                 AND msg.author_id <> ${userId}::uuid
                 AND msg.deleted_at IS NULL
                 AND msg.edited_at IS NOT NULL
                 AND msg.edited_at > m.last_read_at
             ))
      RETURNING m.last_read_seq, m.last_read_at
    `);
    let feedAdvanced = false;
    if (feed) {
      const feedRows = await tx.$queryRaw<{ last_feed_read_seq: bigint }[]>(Prisma.sql`
        UPDATE conversation_members m
        SET last_feed_read_seq = GREATEST(m.last_feed_read_seq, ${seq}::bigint),
            last_feed_read_at = now(),
            updated_at = now()
        WHERE m.conversation_id = ${conversationId}::uuid AND m.user_id = ${userId}::uuid
          AND (m.last_feed_read_seq < ${seq}::bigint
               OR m.last_feed_read_at IS NULL
               OR EXISTS (
                 SELECT 1 FROM messages msg
                 WHERE msg.conversation_id = ${conversationId}::uuid
                   AND msg.thread_root_id IS NULL
                   AND msg.author_id <> ${userId}::uuid
                   AND msg.deleted_at IS NULL
                   AND msg.edited_at IS NOT NULL
                   AND msg.edited_at > m.last_feed_read_at
               ))
        RETURNING m.last_feed_read_seq
      `);
      feedAdvanced = feedRows.length > 0;
    }
    if (rows.length === 0) {
      return { advanced: feedAdvanced, lastReadAt: feedAdvanced ? new Date() : null };
    }
    return { advanced: true, lastReadAt: rows[0]?.last_read_at ?? null };
  }
}
