import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

import { PrismaService } from '../../core/database/prisma.service.js';
import { TASK_CHAT_READER, type TaskChatReader } from '../tasks/ports/task-chat-reader.port.js';
import type {
  ChatConversationRef,
  ChatConversationState,
  ChatMembershipReader,
} from './membership-reader.port.js';

interface MemberStateRow {
  user_id: string;
  muted: boolean;
}

interface ConversationStateRow {
  type: string;
  title: string | null;
}

/** Реализация read-порта членства (таблицы чата — только из модуля chat). */
@Injectable()
export class MembershipReaderProvider implements ChatMembershipReader {
  constructor(
    private readonly prisma: PrismaService,
    // Гейтованный набор решающего (#952) — через порт задач, не таблицу.
    @Inject(TASK_CHAT_READER) private readonly taskChat: TaskChatReader,
  ) {}

  async conversationState(conversationId: string): Promise<ChatConversationState | null> {
    const conversation = await this.prisma.$queryRaw<ConversationStateRow[]>(Prisma.sql`
      SELECT type, title FROM conversations WHERE id = ${conversationId}::uuid
    `);
    if (conversation.length === 0) return null;
    const members = await this.prisma.$queryRaw<MemberStateRow[]>(Prisma.sql`
      SELECT user_id, muted FROM conversation_members
      WHERE conversation_id = ${conversationId}::uuid AND hidden = false
    `);
    return {
      type: conversation[0]!.type as ChatConversationState['type'],
      title: conversation[0]!.title,
      members: members.map((m) => ({ userId: m.user_id, muted: m.muted })),
    };
  }

  async threadWatcherIds(threadRootId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>(Prisma.sql`
      SELECT user_id FROM thread_participants WHERE thread_root_id = ${threadRootId}::uuid
    `);
    return rows.map((r) => r.user_id);
  }

  /** Читаемые беседы (#952): членство без hidden (архив доступен) ∪ чаты
   *  задач, где пользователь — решающий и задача ему видима. */
  async readableConversationIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    const ids = new Set(memberships.map((m) => m.conversationId));
    const deciderTaskIds = await this.taskChat.deciderTaskIds(userId);
    if (deciderTaskIds.length > 0) {
      const taskChats = await this.prisma.conversation.findMany({
        where: { taskId: { in: deciderTaskIds } },
        select: { id: true },
      });
      for (const chat of taskChats) ids.add(chat.id);
    }
    return [...ids];
  }

  async conversationRefs(ids: string[]): Promise<ChatConversationRef[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.conversation.findMany({
      where: { id: { in: ids } },
      select: { id: true, type: true, title: true, taskId: true, letterId: true },
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type as ChatConversationRef['type'],
      title: row.title,
      taskId: row.taskId,
      letterId: row.letterId,
    }));
  }
}
