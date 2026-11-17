import { z } from 'zod';
import {
  attachmentRenameSchema,
  forwardMessagesBodySchema,
  messageReactionToggleBodySchema,
  type ChatMessage,
  type MessagePin,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asArray, asRecord, asTyped, clip, str } from '../projections.js';
import { conversationTitle, field, fieldsOf, shortId } from './write-cards.js';
import { chatMessagesMeta } from './meta/chat-messages-actions.meta.js';

/**
 * Дневные действия с сообщениями (#929): правка, закрепление, реакция,
 * пересылка. Запись — только карточкой (ADR-0048); удаление сообщений и
 * массовые операции не входят (опасные — отдельное решение владельца).
 */

const messageInput = z.object({ conversationId: z.uuid(), messageId: z.uuid() });

const editInput = z
  .object({
    conversationId: z.uuid(),
    messageId: z.uuid(),
    text: z.string().trim().max(4000),
    attachmentIds: z.array(z.uuid()).max(20).optional(),
    attachmentRenames: z.array(attachmentRenameSchema).max(20).optional(),
  })
  .refine((value) => value.text.length > 0 || (value.attachmentIds?.length ?? 0) > 0, {
    message: 'Нужен текст или вложения',
  });

export const chatEditMessageTool = defineTool({
  ...chatMessagesMeta['chat.edit_message'],
  id: 'chat.edit_message',
  title: 'Мессенджер: изменить сообщение',
  description:
    'Изменить текст своего сообщения (и состав вложений). Действие появится карточкой подтверждения; права на правку проверяет API.',
  keywords: ['изменить сообщение', 'исправить сообщение', 'правка сообщения', 'edit message'],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: false,
  input: editInput,
  api: { method: 'PATCH', path: '/chat/conversations/:id/messages/:messageId' },
  build: (input) => ({
    method: 'PATCH',
    path: `/chat/conversations/${input.conversationId}/messages/${input.messageId}`,
    body: {
      text: input.text,
      ...(input.attachmentIds ? { attachmentIds: input.attachmentIds } : {}),
      ...(input.attachmentRenames ? { attachmentRenames: input.attachmentRenames } : {}),
    },
  }),
  project: (data: ChatMessage, input) => {
    const message = asTyped<ChatMessage>(data);
    return {
      text: `Сообщение изменено: «${clip(str(message?.text) ?? input.text, 300)}»`,
      entity: { href: `?cards=messenger:${input.conversationId}`, label: 'Беседа' },
    };
  },
  card: {
    title: 'Изменить сообщение',
    summary: async (input, ctx) =>
      `Правка сообщения в «${(await conversationTitle(ctx, input.conversationId)) ?? shortId(input.conversationId)}»`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Беседа', await conversationTitle(ctx, input.conversationId)),
        field('Было', await messagePreview(ctx, input.conversationId, input.messageId)),
        field('Станет', clip(input.text, 500)),
        field('Вложения', input.attachmentIds ? `состав: ${input.attachmentIds.length}` : null),
      ]),
    consequences:
      'Новый текст увидят все участники; отметка «изменено» появится у сообщения. Автоматической отмены нет.',
  },
});

export const chatPinMessageTool = defineTool({
  ...chatMessagesMeta['chat.pin_message'],
  id: 'chat.pin_message',
  title: 'Мессенджер: закрепить сообщение',
  description:
    'Закрепить сообщение в беседе (лента закрепов). Действие появится карточкой подтверждения; права проверяет API.',
  keywords: ['закрепить сообщение', 'закреп', 'pin message'],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: false,
  input: messageInput,
  api: { method: 'POST', path: '/chat/conversations/:id/messages/:messageId/pin' },
  build: (input) => ({
    method: 'POST',
    path: `/chat/conversations/${input.conversationId}/messages/${input.messageId}/pin`,
  }),
  project: (data: MessagePin, input) => {
    const pin = asTyped<MessagePin>(data);
    return {
      text: `Сообщение закреплено: «${clip(str(pin?.message?.text) ?? 'без текста', 200)}»`,
      entity: { href: `?cards=messenger:${input.conversationId}`, label: 'Беседа' },
    };
  },
  card: {
    title: 'Закрепить сообщение',
    summary: async (input, ctx) =>
      `Закрепить в «${(await conversationTitle(ctx, input.conversationId)) ?? shortId(input.conversationId)}»`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Беседа', await conversationTitle(ctx, input.conversationId)),
        field('Сообщение', await messagePreview(ctx, input.conversationId, input.messageId)),
      ]),
    consequences:
      'Сообщение появится в ленте закрепов беседы. Закрепление можно отменить кнопкой «Отменить».',
    undo: (input) => ({
      method: 'DELETE',
      path: `/chat/conversations/${input.conversationId}/messages/${input.messageId}/pin`,
    }),
  },
});

export const chatUnpinMessageTool = defineTool({
  ...chatMessagesMeta['chat.unpin_message'],
  id: 'chat.unpin_message',
  title: 'Мессенджер: открепить сообщение',
  description:
    'Убрать сообщение из ленты закрепов беседы. Действие появится карточкой подтверждения.',
  keywords: [
    'открепить сообщение',
    'убери из закрепов',
    'снять закреп',
    'убрать из закрепов',
    'unpin',
  ],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: false,
  input: messageInput,
  api: { method: 'DELETE', path: '/chat/conversations/:id/messages/:messageId/pin' },
  build: (input) => ({
    method: 'DELETE',
    path: `/chat/conversations/${input.conversationId}/messages/${input.messageId}/pin`,
  }),
  project: (_data: void, input) => ({
    text: 'Сообщение откреплено',
    entity: { href: `?cards=messenger:${input.conversationId}`, label: 'Беседа' },
  }),
  card: {
    title: 'Открепить сообщение',
    summary: async (input, ctx) =>
      `Открепить в «${(await conversationTitle(ctx, input.conversationId)) ?? shortId(input.conversationId)}»`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Беседа', await conversationTitle(ctx, input.conversationId)),
        field('Сообщение', await messagePreview(ctx, input.conversationId, input.messageId)),
      ]),
    consequences:
      'Сообщение исчезнет из закрепов, но останется в ленте. Автоматической отмены нет — закрепите снова вручную.',
  },
});

export const chatReactTool = defineTool({
  ...chatMessagesMeta['chat.react'],
  id: 'chat.react',
  title: 'Мессенджер: поставить реакцию',
  description:
    'Поставить или снять свою реакцию (эмодзи) на сообщение. Действие появится карточкой подтверждения.',
  keywords: ['реакция', 'эмодзи', 'лайк', 'поставить реакцию', 'react'],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: false,
  input: messageReactionToggleBodySchema.extend(messageInput.shape),
  api: { method: 'POST', path: '/chat/conversations/:id/messages/:messageId/reactions' },
  build: (input) => ({
    method: 'POST',
    path: `/chat/conversations/${input.conversationId}/messages/${input.messageId}/reactions`,
    body: { emoji: input.emoji, ...(input.remove !== undefined ? { remove: input.remove } : {}) },
  }),
  project: (_data: ChatMessage, input) => ({
    text: `Реакция ${input.emoji} ${input.remove ? 'снята' : 'поставлена'}`,
    entity: { href: `?cards=messenger:${input.conversationId}`, label: 'Беседа' },
  }),
  card: {
    title: 'Реакция на сообщение',
    summary: async (input, ctx) =>
      `${input.remove ? 'Снять' : 'Поставить'} ${input.emoji} в «${(await conversationTitle(ctx, input.conversationId)) ?? shortId(input.conversationId)}»`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Беседа', await conversationTitle(ctx, input.conversationId)),
        field('Сообщение', await messagePreview(ctx, input.conversationId, input.messageId)),
        field('Реакция', input.emoji),
        field('Действие', input.remove ? 'снять' : 'поставить'),
      ]),
    consequences: 'Реакцию увидят участники; повторное действие её снимает.',
    undo: (input) => ({
      method: 'POST',
      path: `/chat/conversations/${input.conversationId}/messages/${input.messageId}/reactions`,
      body: { emoji: input.emoji, remove: !input.remove },
    }),
  },
});

export const chatForwardMessageTool = defineTool({
  ...chatMessagesMeta['chat.forward_message'],
  id: 'chat.forward_message',
  title: 'Мессенджер: переслать сообщения',
  description:
    'Переслать сообщения из одной беседы в другую, при желании с комментарием. Действие появится карточкой подтверждения; доступ к обеим беседам проверяет API.',
  keywords: ['переслать', 'переслать сообщение', 'forward', 'скинь в чат'],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: false,
  input: forwardMessagesBodySchema.extend({ conversationId: z.uuid() }),
  api: { method: 'POST', path: '/chat/conversations/:id/forward' },
  build: (input) => ({
    method: 'POST',
    path: `/chat/conversations/${input.conversationId}/forward`,
    body: {
      sourceConversationId: input.sourceConversationId,
      messageIds: input.messageIds,
      ...(input.comment ? { comment: input.comment } : {}),
      ...(input.threadRootId !== undefined ? { threadRootId: input.threadRootId } : {}),
    },
  }),
  project: (data: ChatMessage[], input) => {
    const copies = asArray(data).length;
    return {
      text: `Переслано сообщений: ${copies || input.messageIds.length} → «${shortId(input.conversationId)}»`,
      entity: { href: `?cards=messenger:${input.conversationId}`, label: 'Беседа' },
    };
  },
  card: {
    title: 'Переслать сообщения',
    summary: async (input, ctx) => {
      const [source, target] = await Promise.all([
        conversationTitle(ctx, input.sourceConversationId),
        conversationTitle(ctx, input.conversationId),
      ]);
      return `${input.messageIds.length} сообщ. из «${source ?? shortId(input.sourceConversationId)}» → «${target ?? shortId(input.conversationId)}»`;
    },
    fields: async (input, ctx) =>
      fieldsOf([
        field('Откуда', await conversationTitle(ctx, input.sourceConversationId)),
        field('Куда', await conversationTitle(ctx, input.conversationId)),
        field('Сообщений', String(input.messageIds.length)),
        field('Комментарий', input.comment ? clip(input.comment, 400) : null),
      ]),
    consequences:
      'В целевой беседе появятся копии сообщений с пометкой «переслано». Автоматической отмены нет.',
  },
});

async function messagePreview(
  ctx: ToolContext,
  conversationId: string,
  messageId: string,
): Promise<string | null> {
  try {
    const page = asRecord(
      await ctx.read?.(`/chat/conversations/${conversationId}/messages?limit=50`),
    );
    const message = asArray(page?.items)
      .map((item) => asRecord(item))
      .find((item) => str(item?.id) === messageId);
    const text = str(message?.text);
    return text ? clip(text, 240) : null;
  } catch {
    return null;
  }
}

export const chatMessagesActionsTools = [
  chatEditMessageTool,
  chatPinMessageTool,
  chatUnpinMessageTool,
  chatReactTool,
  chatForwardMessageTool,
];
