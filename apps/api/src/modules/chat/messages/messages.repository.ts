import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  MESSAGE_COLS,
  type MessageAttachmentRow,
  type MessageRow,
  type ThreadCountRow,
} from './message-row.js';

/**
 * Репозиторий агрегата Message — ЧТЕНИЕ: сообщение по id (строго в беседе),
 * батчи для маппера (оригиналы цитат, вложения, счётчики тредов), источники
 * пересылки, лента/треды курсором по seq. Запись разнесена по
 * ответственности (I5): отправка/пересылка — messages-write.repository,
 * правка/удаление — messages-lifecycle.repository, прочитанность —
 * messages-read-state.repository; формы рядов и колонки — message-row.
 */
@Injectable()
export class MessagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: TransactionClient): PrismaService | TransactionClient {
    return tx ?? this.prisma;
  }

  /** Сообщение строго в беседе (не палит чужие беседы). */
  async findByIdInConversation(
    conversationId: string,
    messageId: string,
    tx?: TransactionClient,
  ): Promise<MessageRow | null> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<MessageRow[]>(Prisma.sql`
      SELECT ${MESSAGE_COLS} FROM messages
      WHERE conversation_id = ${conversationId}::uuid AND id = ${messageId}::uuid
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /** Сообщения по id (для маппера: оригиналы цитат; надгробия включительно). */
  async findByIds(messageIds: string[]): Promise<MessageRow[]> {
    if (messageIds.length === 0) return [];
    return this.prisma.$queryRaw<MessageRow[]>(Prisma.sql`
      SELECT ${MESSAGE_COLS} FROM messages WHERE id = ANY(${messageIds}::uuid[])
    `);
  }

  /** Живые сообщения беседы по id в порядке seq (#380: окно перехода —
   *  файлы/сообщения итога бывают вне загруженной ленты). */
  async findLiveByIdsInConversation(
    conversationId: string,
    messageIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<MessageRow[]> {
    if (messageIds.length === 0) return [];
    const client = this.client(tx);
    return client.$queryRaw<MessageRow[]>(Prisma.sql`
      SELECT ${MESSAGE_COLS} FROM messages
      WHERE conversation_id = ${conversationId}::uuid
        AND id = ANY(${[...messageIds]}::uuid[])
        AND deleted_at IS NULL AND NOT obliterated
      ORDER BY seq ASC
    `);
  }

  /** Живые (не obliterated) источники пересылки в исходной беседе, порядок запроса. */
  async findForwardSources(
    sourceConversationId: string,
    messageIds: string[],
    tx?: TransactionClient,
  ): Promise<MessageRow[]> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<MessageRow[]>(Prisma.sql`
      SELECT ${MESSAGE_COLS} FROM messages
      WHERE conversation_id = ${sourceConversationId}::uuid
        AND id = ANY(${messageIds}::uuid[])
        AND NOT obliterated
        AND deleted_at IS NULL
    `);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return messageIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  /**
   * Страница ленты (новейшие → назад) или треда (корень первым на первой
   * странице + ответы новейшие→назад). Возврат — ASC внутри страницы,
   * hasMore по limit+1. Надгробия в выдаче, obliterated — никогда.
   */
  async listPage(
    conversationId: string,
    opts: { limit: number; beforeSeq: bigint | null; threadRootId: string | null },
  ): Promise<{ rows: MessageRow[]; hasMore: boolean }> {
    if (opts.threadRootId === null) {
      // Лента без threadRootId — ВСЕ сообщения беседы, включая ответы тредов
      // (мок-контракт: прямые/групповые беседы рендерят ответы инлайн —
      // conversation-pane; «только корни» — клиентский фильтр канального вида
      // thread-feed.tsx, сервер его не решает). lastMessage при этом — только
      // корневое (LATERAL-фильтр), как в моках.
      const rows = await this.prisma.$queryRaw<MessageRow[]>(Prisma.sql`
        SELECT ${MESSAGE_COLS} FROM messages
        WHERE conversation_id = ${conversationId}::uuid
          AND NOT obliterated
          AND (${opts.beforeSeq === null} OR seq < ${opts.beforeSeq?.toString() ?? '0'}::bigint)
        ORDER BY seq DESC
        LIMIT ${opts.limit + 1}
      `);
      return this.cutPage(rows.reverse(), opts.limit);
    }
    const replies = await this.prisma.$queryRaw<MessageRow[]>(Prisma.sql`
      SELECT ${MESSAGE_COLS} FROM messages
      WHERE conversation_id = ${conversationId}::uuid
        AND thread_root_id = ${opts.threadRootId}::uuid
        AND NOT obliterated
        AND (${opts.beforeSeq === null} OR seq < ${opts.beforeSeq?.toString() ?? '0'}::bigint)
      ORDER BY seq DESC
      LIMIT ${opts.limit + 1}
    `);
    const page = this.cutPage(replies.reverse(), opts.limit);
    if (opts.beforeSeq === null) {
      const roots = await this.prisma.$queryRaw<MessageRow[]>(Prisma.sql`
        SELECT ${MESSAGE_COLS} FROM messages
        WHERE conversation_id = ${conversationId}::uuid AND id = ${opts.threadRootId}::uuid
          AND NOT obliterated
        LIMIT 1
      `);
      if (roots[0]) page.rows.unshift(roots[0]);
    }
    return page;
  }

  private cutPage(rowsAsc: MessageRow[], limit: number): { rows: MessageRow[]; hasMore: boolean } {
    const hasMore = rowsAsc.length > limit;
    return { rows: hasMore ? rowsAsc.slice(rowsAsc.length - limit) : rowsAsc, hasMore };
  }

  /** Вложения сообщений (для маппера; tx — чтение в транзакции отправки,
   *  когда строка ещё не закоммичена — payload события, раунд 3). */
  async attachmentsFor(
    messageIds: string[],
    tx?: TransactionClient,
  ): Promise<MessageAttachmentRow[]> {
    if (messageIds.length === 0) return [];
    const client = this.client(tx);
    return client.$queryRaw<MessageAttachmentRow[]>(Prisma.sql`
      SELECT message_id AS "messageId", id, file_id AS "fileId", name, size, mime, kind,
             width, height, duration_ms AS "durationMs", thumb_file_id AS "thumbFileId", sticker_meta AS "stickerMeta",
             sort_order AS "sortOrder"
      FROM message_attachments
      WHERE message_id = ANY(${messageIds}::uuid[])
      ORDER BY sort_order ASC, id ASC
    `);
  }

  /** Живые ответы тредов (счётчик в DTO; удалённые не считаются). */
  async threadReplyCounts(rootIds: string[]): Promise<ThreadCountRow[]> {
    if (rootIds.length === 0) return [];
    return this.prisma.$queryRaw<ThreadCountRow[]>(Prisma.sql`
      SELECT thread_root_id AS "rootId", COUNT(*)::int AS count
      FROM messages
      WHERE thread_root_id = ANY(${rootIds}::uuid[]) AND deleted_at IS NULL AND NOT obliterated
      GROUP BY thread_root_id
    `);
  }

  /** Ответы треда, кроме исключаемого (детект «первый ответ» для события). */
  async countThreadReplies(
    threadRootId: string,
    excludeMessageId: string,
    tx: TransactionClient,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM messages
      WHERE thread_root_id = ${threadRootId}::uuid AND id <> ${excludeMessageId}::uuid
    `);
    return rows[0]?.count ?? 0;
  }

  /** Все ответы треда (живые и надгробия; детект «тред существовал» пересылки). */
  async countAllThreadReplies(threadRootId: string, tx: TransactionClient): Promise<number> {
    const rows = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM messages
      WHERE thread_root_id = ${threadRootId}::uuid
    `);
    return rows[0]?.count ?? 0;
  }
}
