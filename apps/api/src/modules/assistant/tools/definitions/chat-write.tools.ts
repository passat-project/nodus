import { z } from 'zod';

import { defineTool } from '../tool-definition.js';
import { asRecord, clip, str } from '../projections.js';
import { conversationTitle, field, fieldsOf, shortId } from './write-cards.js';

/**
 * Сообщения (Ф2, ADR-0048): отправка в СУЩЕСТВУЮЩУЮ беседу или чат задачи.
 * Создание бесед и групп — вне скоупа Ф2. Запись идёт карточкой
 * подтверждения от имени сотрудника: членство и право поста проверяет API.
 */

const taskConversationInput = z.object({ taskId: z.uuid() });

export const chatTaskConversationTool = defineTool({
  id: 'chat.task_conversation',
  title: 'Мессенджер: чат задачи',
  description:
    'Беседа задачи по id: возвращает id беседы для chat.send. Если чат задачи ещё не открывали, портал создаст его — как при открытии карточки задачи.',
  keywords: ['чат задачи', 'комментарий к задаче', 'обсуждение задачи', 'task chat'],
  module: 'chat',
  kind: 'read',
  featureFlag: 'chat',
  hot: false,
  input: taskConversationInput,
  api: { method: 'GET', path: '/chat/conversations/by-task/:taskId' },
  build: (input) => ({ path: `/chat/conversations/by-task/${input.taskId}` }),
  project: (data) => {
    const conversation = asRecord(data);
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
  project: (data, input) => {
    const message = asRecord(data);
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

export const chatWriteTools = [chatTaskConversationTool, chatSendTool];
