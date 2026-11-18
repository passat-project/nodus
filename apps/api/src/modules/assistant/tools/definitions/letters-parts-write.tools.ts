import { z } from 'zod';

import {
  Permission,
  addLetterParticipantBodySchema,
  setLetterMainDocumentBodySchema,
  updateLetterBodySchema,
  type LetterDetail,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asArray, asRecord, clip, str } from '../projections.js';
import {
  counterpartyName,
  field,
  fieldsOf,
  humanDate,
  letterLabel,
  projectName,
  shortId,
  userName,
} from './write-cards.js';
import { letterEntity, names, successText } from './letters-write-cards.js';
import { lettersRelationsActionsTools } from './letters-relations-actions-write.tools.js';
import { lettersPartsMeta } from './meta/letters-parts.meta.js';

/**
 * Дневные действия по письмам (#930): правка реквизитов, основной документ,
 * участники, присоединение, связи и кнопки действий. Всё — карточкой
 * подтверждения (ADR-0048); опасное (удаление, формулы, публикация) не
 * реализуется без отдельного решения владельца.
 */

const PATCH_LABEL: Record<string, string> = {
  counterpartyId: 'Контрагент',
  signerId: 'Подписант',
  theirNumber: '№ корреспондента',
  theirDate: 'Дата корреспондента',
  subject: 'Тема',
  receiptMethodId: 'Способ доставки',
  projectId: 'Проект',
  addresseeId: 'Адресат',
  responseDeadline: 'Срок ответа',
  confidential: 'Конфиденциально',
  attachedRefs: 'Приложенные письма',
  customFields: 'Атрибуты',
};

export const lettersUpdateTool = defineTool({
  ...lettersPartsMeta['letters.update'],
  id: 'letters.update',
  title: 'Письма: изменить реквизиты',
  description:
    'Исправить реквизиты письма: тему, номер и дату корреспондента, срок ответа, контрагента, проект, конфиденциальность. Действие появится карточкой подтверждения; права и ограничения стадии проверяет API.',
  keywords: [
    'изменить письмо',
    'исправить тему письма',
    'срок ответа',
    'поменять контрагента',
    'конфиденциально',
    'update letter',
  ],
  module: 'letters',
  kind: 'write',
  permission: Permission.CORRESPONDENCE_REGISTER,
  featureFlag: 'correspondence',
  hot: false,
  input: z.object({ letterId: z.uuid(), patch: updateLetterBodySchema }),
  api: { method: 'PATCH', path: '/letters/:id' },
  build: (input) => ({
    method: 'PATCH',
    path: `/letters/${input.letterId}`,
    body: input.patch,
  }),
  project: (data: LetterDetail) => ({
    text: successText(data, 'Реквизиты письма обновлены'),
    entity: letterEntity(data),
  }),
  card: {
    title: 'Изменить реквизиты письма',
    summary: async (input, ctx) =>
      `${(await letterLabel(ctx, input.letterId)) ?? shortId(input.letterId)}: ${Object.keys(
        input.patch,
      )
        .map((key) => PATCH_LABEL[key] ?? key)
        .join(', ')}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Письмо', await letterLabel(ctx, input.letterId)),
        ...(await Promise.all(
          Object.entries(input.patch).map(([key, value]) => patchField(key, value, ctx)),
        )),
      ]),
    consequences:
      'Изменения сохранятся в истории письма. Номер регистрации так не меняется, а адресат — только до регистрации; автоматической отмены нет.',
  },
});

async function patchField(
  key: string,
  value: unknown,
  ctx: ToolContext,
): Promise<{ label: string; value: string } | null> {
  const label = PATCH_LABEL[key] ?? key;
  if (value === null) return field(label, 'очистить');
  if (key === 'counterpartyId' && typeof value === 'string') {
    return field(label, (await counterpartyName(ctx, value)) ?? value);
  }
  if ((key === 'signerId' || key === 'addresseeId') && typeof value === 'string') {
    return field(label, (await userName(ctx, value)) ?? value);
  }
  if (key === 'projectId' && typeof value === 'string') {
    return field(label, (await projectName(ctx, value)) ?? value);
  }
  if (key === 'theirDate' || key === 'responseDeadline') {
    return field(label, humanDate(typeof value === 'string' ? value : undefined));
  }
  if (key === 'confidential') return field(label, value ? 'да' : 'нет');
  if (key === 'attachedRefs' && Array.isArray(value)) return field(label, `строк: ${value.length}`);
  if (key === 'customFields') return field(label, 'изменены');
  return field(label, typeof value === 'string' ? clip(value, 300) : String(value));
}

export const lettersSetMainDocumentTool = defineTool({
  ...lettersPartsMeta['letters.set_main_document'],
  id: 'letters.set_main_document',
  title: 'Письма: основной документ',
  description:
    'Отметить звёздочкой основной документ письма (вложение или PDF-копию тела) до регистрации. После регистрации выбор заморожен; права проверяет API.',
  keywords: ['основной документ', 'звезда', 'главный файл письма', 'main document'],
  module: 'letters',
  kind: 'write',
  permission: Permission.CORRESPONDENCE_REGISTER,
  featureFlag: 'correspondence',
  hot: false,
  input: setLetterMainDocumentBodySchema.extend({ letterId: z.uuid() }),
  api: { method: 'POST', path: '/letters/:id/main-document' },
  build: (input) => ({
    method: 'POST',
    path: `/letters/${input.letterId}/main-document`,
    body: { attachmentId: input.attachmentId },
  }),
  project: (data: LetterDetail) => ({
    text: successText(data, 'Основной документ выбран'),
    entity: letterEntity(data),
  }),
  card: {
    title: 'Выбрать основной документ',
    summary: async (input, ctx) =>
      `${(await letterLabel(ctx, input.letterId)) ?? shortId(input.letterId)} → ${(await attachmentName(ctx, input.letterId, input.attachmentId)) ?? shortId(input.attachmentId)}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Письмо', await letterLabel(ctx, input.letterId)),
        field('Документ', await attachmentName(ctx, input.letterId, input.attachmentId)),
      ]),
    consequences:
      'Звёздочка перейдёт выбранному документу; после регистрации письма выбор заморожен. Автоматической отмены нет.',
  },
});

async function attachmentName(
  ctx: ToolContext,
  letterId: string,
  attachmentId: string,
): Promise<string | null> {
  if (!ctx.read) return null;
  try {
    const data = asRecord(await ctx.read(`/letters/${letterId}`));
    for (const raw of asArray(data?.attachments)) {
      const attachment = asRecord(raw);
      if (str(attachment?.id) === attachmentId) return str(attachment?.name);
    }
  } catch {
    return null;
  }
  return null;
}

export const lettersAddParticipantTool = defineTool({
  ...lettersPartsMeta['letters.add_participant'],
  id: 'letters.add_participant',
  title: 'Письма: пригласить в обсуждение',
  description:
    'Пригласить коллег в обсуждение письма (до 20 человек). Действие появится карточкой подтверждения; право канцелярии проверяет API.',
  keywords: ['пригласить в обсуждение', 'добавить коллегу к письму', 'участники письма'],
  module: 'letters',
  kind: 'write',
  permission: Permission.CORRESPONDENCE_REGISTER,
  featureFlag: 'correspondence',
  hot: false,
  input: addLetterParticipantBodySchema.extend({ letterId: z.uuid() }),
  api: { method: 'POST', path: '/letters/:id/participants' },
  build: (input) => ({
    method: 'POST',
    path: `/letters/${input.letterId}/participants`,
    body: { userIds: input.userIds },
  }),
  project: (data: LetterDetail) => ({
    text: successText(data, 'Участники приглашены'),
    entity: letterEntity(data),
  }),
  card: {
    title: 'Пригласить в обсуждение письма',
    summary: async (input, ctx) =>
      `${await names(ctx, input.userIds)} → ${(await letterLabel(ctx, input.letterId)) ?? shortId(input.letterId)}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Письмо', await letterLabel(ctx, input.letterId)),
        field('Коллеги', await names(ctx, input.userIds)),
      ]),
    consequences:
      'Коллеги получат доступ к обсуждению письма. Убрать участника через ассистента нельзя — только в карточке письма.',
  },
});

export const lettersJoinTool = defineTool({
  ...lettersPartsMeta['letters.join'],
  id: 'letters.join',
  title: 'Письма: присоединиться к обсуждению',
  description:
    'Присоединиться к обсуждению письма: сотрудник становится участником и видит чат. Действие идемпотентно и появится карточкой подтверждения.',
  keywords: ['присоединиться к письму', 'в обсуждение письма', 'добавь меня к письму'],
  module: 'letters',
  kind: 'write',
  featureFlag: 'correspondence',
  hot: false,
  input: z.object({ letterId: z.uuid() }),
  api: { method: 'POST', path: '/letters/:id/join' },
  build: (input) => ({ method: 'POST', path: `/letters/${input.letterId}/join` }),
  project: (data: LetterDetail) => ({
    text: successText(data, 'Вы присоединились к обсуждению'),
    entity: letterEntity(data),
  }),
  card: {
    title: 'Присоединиться к обсуждению',
    summary: async (input, ctx) =>
      `Вы → ${(await letterLabel(ctx, input.letterId)) ?? shortId(input.letterId)}`,
    fields: async (input, ctx) =>
      fieldsOf([field('Письмо', await letterLabel(ctx, input.letterId))]),
    consequences:
      'Вы станете участником обсуждения письма и увидите его чат. Автоматической отмены нет.',
  },
});

export const lettersPartsWriteTools = [
  lettersUpdateTool,
  lettersSetMainDocumentTool,
  lettersAddParticipantTool,
  lettersJoinTool,
  ...lettersRelationsActionsTools,
];
