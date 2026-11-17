import { z } from 'zod';

import type {
  ChatMessage,
  ConversationListItem,
  MessageAttachment,
  Paginated,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import {
  asArray,
  asTyped,
  pageItems,
  clip,
  dateTime,
  entityLink,
  finalize,
  hasMore,
  listBlock,
  nameOf,
  num,
  str,
} from '../projections.js';

/**
 * Инструменты мессенджера (#892): беседы сотрудника и сообщения беседы.
 * Границы (ADR-0043 п. 8): чаты — корпоративная переписка компании, доступ
 * в пределах прав сотрудника (членство проверяет API чата). Никаких
 * consent-переключателей: нет права — нет данных.
 */

const conversationsInput = z.object({
  search: z.string().trim().min(1).max(128).optional(),
  scope: z.enum(['all', 'chats', 'entities', 'direct']).default('all'),
  /** Следующая страница из ответа («… есть следующая страница (cursor)»). */
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

export const chatConversationsTool = defineTool({
  id: 'chat.conversations',
  title: 'Мессенджер: беседы',
  description:
    'Беседы сотрудника: личные, группы, чаты задач и писем. Отдаёт название/участников, тип, последнюю активность, непрочитанные и id для chat.messages. ' +
    'Для личной переписки с конкретным человеком передай scope=direct и search по имени: без этого фильтра личный чат стоит в общем списке по активности и легко уходит за первую страницу. ' +
    'Если в ответе «… есть следующая страница (cursor)» — продолжай с параметром cursor.',
  keywords: ['беседы', 'чаты', 'мессенджер', 'переписка', 'непрочитанные', 'conversations'],
  module: 'chat',
  kind: 'read',
  featureFlag: 'chat',
  hot: true,
  input: conversationsInput,
  api: { method: 'GET', path: '/chat/conversations' },
  build: (input) => ({
    path: '/chat/conversations',
    query: {
      scope: input.scope,
      limit: String(input.limit),
      ...(input.search ? { search: input.search } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    },
  }),
  project: (data: Paginated<ConversationListItem>) => {
    // Форма `GET /chat/conversations` — conversationListItemSchema:
    // `membersPreview` (превью участников) и `lastActivityAt` (момент
    // активности; `lastMessage` — только превью). Полей `members`/
    // `lastMessageAt` в контракте нет.
    const rows = pageItems<ConversationListItem>(data).map((raw) => {
      const conversation = asTyped<ConversationListItem>(raw);
      if (!conversation) return null;
      const id = str(conversation.id);
      if (!id) return null;
      const members = asArray(conversation.membersPreview)
        .map(nameOf)
        .filter((name): name is string => Boolean(name));
      const title = str(conversation.title) ?? (members.length > 0 ? members.join(', ') : 'Беседа');
      const parts = [title, `тип ${str(conversation.type) ?? '—'}`];
      const unread = num(conversation.unreadCount);
      if (unread) parts.push(`непрочитанных ${unread}`);
      if (str(conversation.lastActivityAt))
        parts.push(`активность ${dateTime(conversation.lastActivityAt)}`);
      parts.push(`id ${id}`);
      return parts.join(', ');
    });
    // Ссылка «Открыть» — у переписки (chat.messages), не у списка бесед.
    return {
      text: finalize(
        listBlock(
          'Беседы',
          rows.filter((row): row is string => row !== null),
          { more: hasMore(data) },
        ),
      ),
    };
  },
});

const messagesInput = z.object({
  conversationId: z.uuid(),
  limit: z.number().int().min(1).max(30).default(20),
});

export const chatMessagesTool = defineTool({
  id: 'chat.messages',
  title: 'Мессенджер: сообщения',
  description:
    'Последние сообщения беседы: автор, время, текст (обрезан), вложения по именам. Отвечает на «что писали», «о чём договорились», «кто ответил».',
  keywords: ['сообщения', 'переписка', 'что писали', 'беседа', 'messages', 'тред'],
  module: 'chat',
  kind: 'read',
  featureFlag: 'chat',
  hot: true,
  input: messagesInput,
  api: { method: 'GET', path: '/chat/conversations/:id/messages' },
  build: (input) => ({
    path: `/chat/conversations/${input.conversationId}/messages`,
    query: { limit: String(input.limit) },
  }),
  project: (data: Paginated<ChatMessage>, input) => {
    const rows = pageItems<ChatMessage>(data).map((raw) => {
      const message = asTyped<ChatMessage>(raw);
      if (!message) return null;
      const author = nameOf(message.author) ?? '—';
      const when = dateTime(message.createdAt) ?? '—';
      // Вложения — имя + fileId: по нему files.extract_text читает PDF/DOCX.
      const attachments = asArray(message.attachments)
        .map((file) => {
          const record = asTyped<MessageAttachment>(file);
          const name = str(record?.name);
          if (!name) return null;
          const fileId = str(record?.fileId);
          return fileId ? `${name} (fileId ${fileId})` : name;
        })
        .filter((file): file is string => file !== null);
      const text = clip(str(message.text) ?? '(без текста)', 300);
      const files = attachments.length > 0 ? ` [вложения: ${attachments.join(', ')}]` : '';
      return `${when} ${author}: ${text}${files}`;
    });
    return {
      text: finalize(
        listBlock(
          'Сообщения беседы',
          rows.filter((row): row is string => row !== null),
          { maxRows: 30, more: hasMore(data) },
        ),
      ),
      entity: entityLink('messenger', input.conversationId, 'Беседа'),
    };
  },
});

export const chatTools = [chatConversationsTool, chatMessagesTool];
