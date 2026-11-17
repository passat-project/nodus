import { z } from 'zod';
import {
  addConversationMembersBodySchema,
  createConversationBodySchema,
  saveConversationDraftBodySchema,
  type ConversationDraft,
  type ConversationListItem,
  type ConversationMember,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asTyped, clip, str } from '../projections.js';
import { conversationTitle, field, fieldsOf, shortId, userName } from './write-cards.js';
import { chatActionsMeta } from './meta/chat-actions.meta.js';

/**
 * Дневные действия в чатах (#929): беседы, участники, роли, черновик.
 * Всё — карточкой подтверждения (ADR-0048); права матрицы беседы проверяет
 * API, ассистент их не расширяет.
 */

export const chatMembersTool = defineTool({
  ...chatActionsMeta['chat.members'],
  id: 'chat.members',
  title: 'Мессенджер: участники беседы',
  description:
    'Участники беседы с ролями и id сотрудников: нужны, чтобы выбрать адресата добавления или смены роли, а не угадывать.',
  keywords: ['участники беседы', 'кто в чате', 'состав группы', 'members'],
  module: 'chat',
  kind: 'read',
  featureFlag: 'chat',
  hot: false,
  input: z.object({ id: z.uuid(), limit: z.number().int().min(1).max(100).default(50) }),
  api: { method: 'GET', path: '/chat/conversations/:id/members' },
  build: (input) => ({ path: `/chat/conversations/${input.id}/members` }),
  projection: {
    kind: 'list',
    heading: 'Участники беседы',
    fields: [
      { path: 'user.displayName', label: 'Сотрудник' },
      { path: 'role', label: 'Роль' },
      { path: 'joinedAt', label: 'В беседе с', format: 'date' },
    ],
  },
});

const TYPE_LABEL: Record<string, string> = {
  group: 'группа',
  project_channel: 'канал проекта',
};
const VISIBILITY_LABEL: Record<string, string> = {
  closed: 'закрытая',
  open: 'открытая',
};
const ROLE_LABEL: Record<string, string> = {
  owner: 'владелец',
  admin: 'модератор',
  member: 'участник',
};

export const chatCreateConversationTool = defineTool({
  ...chatActionsMeta['chat.create_conversation'],
  id: 'chat.create_conversation',
  title: 'Мессенджер: создать беседу',
  description:
    'Создать группу или канал проекта: название обязательно, участники, описание и видимость — по желанию. Действие появится карточкой подтверждения; права проверяет API.',
  keywords: ['создать беседу', 'создать группу', 'новый чат', 'канал проекта', 'create chat'],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: false,
  input: createConversationBodySchema,
  api: { method: 'POST', path: '/chat/conversations' },
  build: (input) => ({
    method: 'POST',
    path: '/chat/conversations',
    body: {
      type: input.type,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(input.memberIds ? { memberIds: input.memberIds } : {}),
      ...(input.permissions ? { permissions: input.permissions } : {}),
    },
  }),
  project: (data: ConversationListItem) => {
    const conversation = asTyped<ConversationListItem>(data);
    const id = str(conversation?.id);
    const title = str(conversation?.title) ?? 'Беседа';
    return id
      ? {
          text: `Беседа создана: «${title}», id ${id}`,
          entity: { href: `?cards=messenger:${id}`, label: title },
        }
      : { text: `Беседа создана: «${title}»` };
  },
  card: {
    title: 'Создать беседу',
    summary: async (input) =>
      `«${input.title}» (${TYPE_LABEL[input.type] ?? input.type})${input.memberIds?.length ? `, участников: ${input.memberIds.length + 1}` : ''}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Название', input.title),
        field('Тип', TYPE_LABEL[input.type] ?? input.type),
        field('Видимость', input.visibility ? VISIBILITY_LABEL[input.visibility] : null),
        field('Участники', await names(ctx, input.memberIds)),
        field('Описание', input.description ? clip(input.description, 400) : null),
      ]),
    consequences:
      'Беседа появится в мессенджере у всех участников; вы станете владельцем. Удаления беседы через ассистента нет — отмена невозможна.',
  },
});

export const chatAddMembersTool = defineTool({
  ...chatActionsMeta['chat.add_members'],
  id: 'chat.add_members',
  title: 'Мессенджер: добавить участников',
  description:
    'Добавить сотрудников в группу или канал. Действие появится карточкой подтверждения; право addMembers и лимит участников проверяет API.',
  keywords: [
    'добавить в чат',
    'добавить в беседу',
    'добавить участников',
    'пригласить в беседу',
    'add members',
  ],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: false,
  input: addConversationMembersBodySchema.extend({ conversationId: z.uuid() }),
  api: { method: 'POST', path: '/chat/conversations/:id/members' },
  build: (input) => ({
    method: 'POST',
    path: `/chat/conversations/${input.conversationId}/members`,
    body: { userIds: input.userIds },
  }),
  project: (data: ConversationListItem, input) => {
    const conversation = asTyped<ConversationListItem>(data);
    return {
      text: `Участники добавлены: ${input.userIds.length}`,
      entity: {
        href: `?cards=messenger:${str(conversation?.id) ?? input.conversationId}`,
        label: str(conversation?.title) ?? 'Беседа',
      },
    };
  },
  card: {
    title: 'Добавить участников',
    summary: async (input, ctx) => {
      const [memberNames, conversation] = await Promise.all([
        names(ctx, input.userIds),
        conversationTitle(ctx, input.conversationId),
      ]);
      return `${clip(memberNames ?? `${input.userIds.length} участник(ов)`, 160)} → «${conversation ?? shortId(input.conversationId)}»`;
    },
    fields: async (input, ctx) =>
      fieldsOf([
        field('Беседа', await conversationTitle(ctx, input.conversationId)),
        field('Участники', await names(ctx, input.userIds)),
      ]),
    consequences:
      'Сотрудники получат доступ к истории беседы и уведомления. Убрать участника через ассистента нельзя — только в интерфейсе.',
  },
});

export const chatSetMemberRoleTool = defineTool({
  ...chatActionsMeta['chat.set_member_role'],
  id: 'chat.set_member_role',
  title: 'Мессенджер: сменить роль участника',
  description:
    'Назначить модератора или вернуть роль участника в группе/канале. Действие появится карточкой подтверждения; право manageSettings проверяет API.',
  keywords: [
    'назначить модератора',
    'сделать модератором',
    'сменить роль в чате',
    'права участника беседы',
  ],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: false,
  input: z.object({
    conversationId: z.uuid(),
    userId: z.uuid(),
    role: z.enum(['admin', 'member']),
  }),
  api: { method: 'PATCH', path: '/chat/conversations/:id/members/:userId' },
  build: (input) => ({
    method: 'PATCH',
    path: `/chat/conversations/${input.conversationId}/members/${input.userId}`,
    body: { role: input.role },
  }),
  project: (data: ConversationMember, input) => {
    const member = asTyped<ConversationMember>(data);
    const name = str(member?.user?.displayName) ?? 'Сотрудник';
    return {
      text: `${name}: роль «${ROLE_LABEL[input.role] ?? input.role}»`,
      entity: { href: `?cards=messenger:${input.conversationId}`, label: 'Беседа' },
    };
  },
  card: {
    title: 'Сменить роль участника',
    summary: async (input, ctx) => {
      const [conversation, user] = await Promise.all([
        conversationTitle(ctx, input.conversationId),
        userName(ctx, input.userId),
      ]);
      return `${user ?? 'Сотрудник'} → ${ROLE_LABEL[input.role] ?? input.role} в «${conversation ?? shortId(input.conversationId)}»`;
    },
    fields: async (input, ctx) =>
      fieldsOf([
        field('Беседа', await conversationTitle(ctx, input.conversationId)),
        field('Сотрудник', await userName(ctx, input.userId)),
        field('Новая роль', ROLE_LABEL[input.role] ?? input.role),
      ]),
    consequences:
      'Модератор сможет менять настройки беседы и состав. Автоматической отмены нет — верните роль вручную.',
  },
});

export const chatSaveDraftTool = defineTool({
  ...chatActionsMeta['chat.save_draft'],
  id: 'chat.save_draft',
  title: 'Мессенджер: сохранить черновик',
  description:
    'Сохранить черновик сообщения в беседе, не отправляя его. Виден только сотруднику на его устройствах.',
  keywords: ['черновик', 'подготовь ответ', 'не отправляй', 'save draft'],
  module: 'chat',
  kind: 'write',
  featureFlag: 'chat',
  hot: false,
  input: saveConversationDraftBodySchema.extend({ conversationId: z.uuid() }),
  api: { method: 'PUT', path: '/chat/conversations/:id/draft' },
  build: (input) => ({
    method: 'PUT',
    path: `/chat/conversations/${input.conversationId}/draft`,
    body: {
      text: input.text,
      ...(input.revision !== undefined ? { revision: input.revision } : {}),
    },
  }),
  project: (data: ConversationDraft, input) => {
    const draft = asTyped<ConversationDraft>(data);
    return {
      text: `Черновик сохранён (${(str(draft?.text) ?? input.text).length} знаков)`,
      entity: { href: `?cards=messenger:${input.conversationId}`, label: 'Беседа' },
    };
  },
  card: {
    title: 'Сохранить черновик',
    summary: async (input, ctx) =>
      `Черновик в «${(await conversationTitle(ctx, input.conversationId)) ?? shortId(input.conversationId)}»`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Беседа', await conversationTitle(ctx, input.conversationId)),
        field('Текст', clip(input.text, 500)),
      ]),
    consequences:
      'Черновик увидите только вы на своих устройствах; сообщение не отправляется. Отправка — отдельным действием.',
  },
});

async function names(ctx: ToolContext, ids: readonly string[] | undefined): Promise<string | null> {
  if (!ids || ids.length === 0) return null;
  const resolved = await Promise.all(ids.map((id) => userName(ctx, id)));
  return resolved.map((name, index) => name ?? shortId(ids[index]!)).join(', ') || null;
}

export const chatActionsTools = [
  chatMembersTool,
  chatCreateConversationTool,
  chatAddMembersTool,
  chatSetMemberRoleTool,
  chatSaveDraftTool,
];
