import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';
import type { ChatMessageAccess, ChatMessageSnapshot } from './message-access.port.js';

const EXCERPT_MAX = 160;

/** Число живых вложений-файлов/изображений/видео сообщения (стикеры — нет). */
const ATTACHMENT_COUNT = Prisma.sql`(
  SELECT count(*)::int FROM message_attachments ma
  WHERE ma.message_id = m.id AND ma.kind IN ('image', 'video', 'file')
)`;

/** Реализация read-порта доступа к сообщению (таблицы чата — только здесь). */
@Injectable()
export class MessageAccessProvider implements ChatMessageAccess {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: TransactionClient): PrismaService | TransactionClient {
    return tx ?? this.prisma;
  }

  async snapshot(messageId: string, userId: string): Promise<ChatMessageSnapshot | null> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        conversation_id: string;
        title: string | null;
        text: string;
        attachment_count: number;
      }[]
    >(Prisma.sql`
      SELECT m.id, m.conversation_id, c.title, m.text, ${ATTACHMENT_COUNT} AS attachment_count
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
        AND cm.user_id = ${userId}::uuid
      WHERE m.id = ${messageId}::uuid AND m.deleted_at IS NULL AND NOT m.obliterated
    `);
    const row = rows[0];
    if (!row) return null;
    return this.toSnapshot(row);
  }

  async taskDiscussion(conversationId: string): Promise<{ taskId: string; count: number } | null> {
    const rows = await this.prisma.$queryRaw<{ task_id: string; count: number }[]>(Prisma.sql`
      SELECT c.task_id,
        (SELECT count(*)::int FROM messages m
          WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND NOT m.obliterated) AS count
      FROM conversations c
      WHERE c.id = ${conversationId}::uuid AND c.type = 'task' AND c.task_id IS NOT NULL
    `);
    const row = rows[0];
    return row ? { taskId: row.task_id, count: row.count } : null;
  }

  async taskMessages(
    taskId: string,
    messageIds: readonly string[],
    userId: string,
    tx?: TransactionClient,
  ): Promise<ChatMessageSnapshot[]> {
    if (messageIds.length === 0) return [];
    const rows = await this.client(tx).$queryRaw<
      {
        id: string;
        conversation_id: string;
        title: string | null;
        text: string;
        attachment_count: number;
      }[]
    >(Prisma.sql`
      SELECT m.id, m.conversation_id, c.title, m.text, ${ATTACHMENT_COUNT} AS attachment_count
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
        AND cm.user_id = ${userId}::uuid
      WHERE c.type = 'task' AND c.task_id = ${taskId}::uuid
        AND m.id = ANY(${[...messageIds]}::uuid[])
        AND m.deleted_at IS NULL AND NOT m.obliterated
      ORDER BY m.seq ASC
    `);
    return rows.map((row) => this.toSnapshot(row));
  }

  async countAttachments(messageIds: readonly string[], tx?: TransactionClient): Promise<number> {
    if (messageIds.length === 0) return 0;
    const rows = await this.client(tx).$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT count(*)::int AS count
      FROM message_attachments ma
      JOIN messages m ON m.id = ma.message_id
      WHERE ma.message_id = ANY(${[...messageIds]}::uuid[])
        AND ma.kind IN ('image', 'video', 'file')
        AND m.deleted_at IS NULL AND NOT m.obliterated
    `);
    return rows[0]?.count ?? 0;
  }

  private toSnapshot(row: {
    id: string;
    conversation_id: string;
    title: string | null;
    text: string;
    attachment_count: number;
  }): ChatMessageSnapshot {
    const text = row.text.trim();
    return {
      messageId: row.id,
      conversationId: row.conversation_id,
      conversationTitle: row.title,
      excerpt: text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1)}…` : text,
      attachmentCount: row.attachment_count,
    };
  }
}
