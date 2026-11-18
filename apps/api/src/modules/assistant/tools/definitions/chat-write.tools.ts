import { z } from 'zod';

import type { ChatMessage, ConversationListItem } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asArray, asRecord, asTyped, clip, str } from '../projections.js';
import { conversationTitle, field, fieldsOf, shortId, userName } from './write-cards.js';
import { chatMeta } from './meta/chat.meta.js';

/**
 * Сообщения (Ф2, ADR-0048): отправка в СУЩЕСТВУЮЩУЮ беседу или чат задачи.
 * Создание бесед и групп — вне скоупа Ф2. Запись идёт карточкой
 * подтверждения от имени сотрудника: членство и право поста проверяет API.
 */

const taskConversationInput = z.object({ taskId: z.uuid() });

export const chatTaskConversationTool = defineTool({
  ...chatMeta['chat.task_conversation'],
  id: 'chat.task_conversation',
  title: 'Мессенджер: чат задачи',
  description:
    'Беседа задачи по id: возвращает id беседы для chat.send. Если чат задачи ещё не открывали, портал создаст его — как при открытии карточки задачи.',
  keywords: [
    'чат задачи',
    'комментарий к задаче',
    'обсуждение задачи',
    'в чате задачи',
    'task chat',
  ],
  module: 'chat',
  kind: 'read',
  featureFlag: 'chat',
  hot: false,
  input: taskConversationInput,
  api: { method: 'GET', path: '/chat/conversations/by-task/:taskId' },
  build: (input) => ({ path: `/chat/conversations/by-task/${input.taskId}` }),
  project: (data: ConversationListItem) => {
    const conversation = asTyped<ConversationListItem>(data);
    const id = str(conversation?.id);
    if (!id) return { text: 'Чат задачи недоступен' };
    const title = str(conversation?.title) ?? 'Чат задачи';
    return {
      text: `Беседа задачи: «${title}», id ${id}`,
      entity: { href: `?cards=messenger:${id}`, label: title },
    };
  },
});

const sendInput = z.object({
  conversationId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
});

export const chatSendTool = defineTool({
  ...chatMeta['chat.send'],
  id: 'chat.send',
  title: 'Отправить сообщение',
  description:
    'Отправить сообщение в существующую беседу или чат задачи (id из chat.conversations или chat.task_conversation). Действие появится карточкой на подтверждение; отправка — от имени сотрудника, членство и право поста проверяет портал.',
  keywords: [
    'отправить сообщение',
    'написать в чат',
    'ответить в беседе',
    'комментарий',
    'send message',
  ],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: true,
  input: sendInput,
  api: { method: 'POST', path: '/chat/conversations/:id/messages' },
  build: (input) => ({
    method: 'POST',
    path: `/chat/conversations/${input.conversationId}/messages`,
    body: { text: input.text },
  }),
  project: (data: ChatMessage, input) => {
    const message = asTyped<ChatMessage>(data);
    const id = str(message?.id);
    return {
      text: `Сообщение отправлено${id ? ` (id ${id})` : ''}`,
      entity: { href: `?cards=messenger:${input.conversationId}`, label: 'Беседа' },
    };
  },
  card: {
    title: 'Отправить сообщение',
    summary: async (input, ctx) => {
      const title = await conversationTitle(ctx, input.conversationId);
      return `Сообщение в беседу${title ? ` «${title}»` : ''}`;
    },
    fields: async (input, ctx) => {
      const title = await conversationTitle(ctx, input.conversationId);
      return fieldsOf([
        field('Беседа', title ?? `id ${shortId(input.conversationId)}`),
        field('Текст', clip(input.text, 600)),
      ]);
    },
    consequences:
      'Сообщение сразу увидят участники беседы. Отправить можно только туда, где у вас есть право писать.',
    undo: (input, output) => {
      const messageId = str(asRecord(output)?.id);
      return messageId
        ? {
            method: 'DELETE',
            path: `/chat/conversations/${input.conversationId}/messages/${messageId}`,
          }
        : null;
    },
  },
});

const directInput = z.object({
  userId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
});

/**
 * Личное сообщение (#921): найти существующий личный чат или создать его и
 * отправить текст — одной карточкой. Групповые чаты агент НЕ создаёт:
 * там состав участников — решение человека.
 */
export const chatDirectMessageTool = defineTool({
  ...chatMeta['chat.direct_message'],
  id: 'chat.direct_message',
  title: 'Написать сотруднику в личку',
  description:
    'Отправить личное сообщение сотруднику: если личного чата ещё нет, портал создаст его. Сотрудника найди через directory.find_users (нужен id). Действие появится карточкой подтверждения.',
  keywords: [
    'написать в личку',
    'личное сообщение',
    'написать сотруднику',
    'в личные сообщения',
    'direct message',
  ],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: true,
  input: directInput,
  api: { method: 'POST', path: '/chat/conversations/direct/:userId' },
  build: (input) => ({
    method: 'POST',
    path: `/chat/conversations/direct/${input.userId}`,
  }),
  // Второй шаг: отправка в найденный/созданный чат. Id карточки —
  // идемпотентность первого шага; отправка — её суффикс `:2`.
  followUp: (data, input) => {
    const record = asRecord(data);
    // Ответ отправки несёт conversationId — цепочка закончена. Иначе id
    // сообщения был бы принят за id беседы и агент отправил бы второе.
    if (str(record?.conversationId)) return null;
    const conversationId = str(record?.id);
    return conversationId
      ? {
          method: 'POST',
          path: `/chat/conversations/${conversationId}/messages`,
          body: { text: String(input.text) },
        }
      : null;
  },
  project: (data: ChatMessage, input, steps) => {
    const conversation = asTyped<ConversationListItem>(steps?.[0]);
    const message = asTyped<ChatMessage>(data);
    const conversationId = str(conversation?.id) ?? str(message?.conversationId);
    const messageId = str(message?.id);
    const title = str(conversation?.title);
    return {
      text: `Личное сообщение отправлено${title ? ` — «${title}»` : ''}${messageId ? ` (сообщение ${messageId})` : ''}`,
      entity: conversationId
        ? { href: `?cards=messenger:${conversationId}`, label: title ?? 'Личный чат' }
        : undefined,
    };
  },
  card: {
    title: 'Написать сотруднику',
    summary: async (input, ctx) => {
      const name = await userName(ctx, input.userId);
      return `Личное сообщение${name ? ` для ${name}` : ''}`;
    },
    fields: async (input, ctx) => {
      const name = await userName(ctx, input.userId);
      return fieldsOf([
        field('Кому', name ?? input.userId),
        field('Текст', clip(input.text, 600)),
        field('Чат', 'существующий личный чат или будет создан'),
      ]);
    },
    consequences:
      'Сообщение сразу увидят собеседник; если личного чата не было, портал создаст его. Отправить можно только тому, кому разрешено писать.',
    undo: (_input, output) => {
      const steps = asArray(asRecord(output)?.steps);
      const conversationId = str(asRecord(steps[0])?.id);
      const message = asRecord(asRecord(output)?.result);
      const messageId = str(message?.id) ?? str(asRecord(steps[1])?.id);
      return conversationId && messageId
        ? {
            method: 'DELETE',
            path: `/chat/conversations/${conversationId}/messages/${messageId}`,
          }
        : null;
    },
  },
});

export const chatWriteTools = [chatTaskConversationTool, chatSendTool, chatDirectMessageTool];
