import { Prisma } from '../../../generated/prisma/client.js';

/**
 * Формы сырых SQL-рядов агрегата Message и общий список колонок — общие для
 * репозиториев сообщений (чтение / запись / жизненный цикл / прочитанность;
 * разнесены по ответственности, I5). Колонки — одна точка: правка схемы
 * сообщения меняет выдачу всех репозиториев согласованно.
 */

/** Сообщение (сырой SQL-ряд, camelCase-алиасы). seq приходит как bigint. */
export interface MessageRow {
  id: string;
  conversationId: string;
  seq: bigint;
  authorId: string;
  clientMessageId: string;
  text: string;
  /** Вид сообщения (#380): text | task_transition. */
  kind: string;
  /** Данные блока (task_transition); null — обычное сообщение. */
  payload: Prisma.JsonValue | null;
  replyToId: string | null;
  replySnapshot: Prisma.JsonValue | null;
  threadRootId: string | null;
  fwdConversationId: string | null;
  fwdMessageId: string | null;
  fwdAuthorId: string | null;
  fwdThreadRootId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  obliterated: boolean;
  urgent: boolean;
  mentionedUserIds: Prisma.JsonValue | null;
  everMentionedUserIds: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Привязанное вложение (форма для маппера DTO; стикер дополнительно несёт
 *  stickerMeta — StickerAttachmentRow в stickers.repository). */
export interface ClaimedAttachmentRow {
  id: string;
  fileId: string;
  name: string;
  size: number;
  mime: string;
  kind: string;
  width: number | null;
  height: number | null;
  /** Длительность видео, мс (#250); null — не видео/неизвестна. */
  durationMs: number | null;
  thumbFileId: string | null;
}

/** Вложение сообщения для маппера (attachmentsFor: батч по messageId). */
export interface MessageAttachmentRow extends ClaimedAttachmentRow {
  messageId: string;
  stickerMeta: unknown;
  sortOrder: number;
}

export interface ThreadCountRow {
  rootId: string;
  count: number;
}

export const MESSAGE_COLS = Prisma.sql`
  id,
  conversation_id AS "conversationId",
  seq,
  author_id AS "authorId",
  client_message_id AS "clientMessageId",
  text,
  kind,
  payload,
  reply_to_id AS "replyToId",
  reply_snapshot AS "replySnapshot",
  thread_root_id AS "threadRootId",
  fwd_conversation_id AS "fwdConversationId",
  fwd_message_id AS "fwdMessageId",
  fwd_author_id AS "fwdAuthorId",
  fwd_thread_root_id AS "fwdThreadRootId",
  edited_at AS "editedAt",
  deleted_at AS "deletedAt",
  obliterated,
  urgent,
  mentioned_user_ids AS "mentionedUserIds",
  COALESCE(ever_mentioned_user_ids, '[]'::jsonb) AS "everMentionedUserIds",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
