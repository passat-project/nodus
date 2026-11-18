import { z } from 'zod';

import {
  Permission,
  executeActionBodySchema,
  letterRelationCreateBodySchema,
  type LetterDetail,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asArray, asRecord, clip, str } from '../projections.js';
import { field, fieldsOf, formValues, letterLabel, shortId } from './write-cards.js';
import { letterEntity, successText } from './letters-write-cards.js';
import { lettersPartsMeta } from './meta/letters-parts.meta.js';

/**
 * Связи и кнопки действий письма (#930): «ответ на»/«вложено в», нажатие
 * действия с окном ввода. Всё — карточкой подтверждения (ADR-0048).
 */

const RELATION_LABEL: Record<string, string> = {
  reply_to: 'ответ на',
  nested_in: 'вложено в',
};

export const lettersAddRelationTool = defineTool({
  ...lettersPartsMeta['letters.add_relation'],
  id: 'letters.add_relation',
  title: 'Письма: связать письма',
  description:
    'Связать письмо с другим: «ответ на» или «вложено в». Действие появится карточкой подтверждения; права канцелярии и замену связи проверяет API.',
  keywords: ['связать письма', 'ответ на письмо', 'вложено в письмо', 'связь писем'],
  module: 'letters',
  kind: 'write',
  permission: Permission.CORRESPONDENCE_REGISTER,
  featureFlag: 'correspondence',
  hot: false,
  input: letterRelationCreateBodySchema.extend({ letterId: z.uuid() }),
  api: { method: 'POST', path: '/letters/:id/relations' },
  build: (input) => ({
    method: 'POST',
    path: `/letters/${input.letterId}/relations`,
    body: {
      relatedLetterId: input.relatedLetterId,
      kind: input.kind,
      ...(input.replace !== undefined ? { replace: input.replace } : {}),
    },
  }),
  project: (data: LetterDetail) => ({
    text: successText(data, 'Связь письма установлена'),
    entity: letterEntity(data),
  }),
  card: {
    title: 'Связать письма',
    summary: async (input, ctx) =>
      `${(await letterLabel(ctx, input.letterId)) ?? shortId(input.letterId)} — ${RELATION_LABEL[input.kind] ?? input.kind} ${(await letterLabel(ctx, input.relatedLetterId)) ?? shortId(input.relatedLetterId)}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Письмо', await letterLabel(ctx, input.letterId)),
        field('Связать с', await letterLabel(ctx, input.relatedLetterId)),
        field('Вид связи', RELATION_LABEL[input.kind] ?? input.kind),
        field('Заменить существующую', input.replace ? 'да' : null),
      ]),
    consequences:
      'Связь появится в дереве писем («ответ на» / «вложено в»). Снять её можно в карточке письма; автоматической отмены нет.',
  },
});

const pressInput = z.object({
  letterId: z.uuid(),
  actionId: z.uuid(),
  ...executeActionBodySchema.shape,
});

export const lettersPressActionTool = defineTool({
  ...lettersPartsMeta['letters.press_action'],
  id: 'letters.press_action',
  title: 'Письма: нажать действие',
  description:
    'Нажать кнопку действия письма без смены статуса: id из letters.actions, при необходимости — поля окна. Действие появится карточкой подтверждения.',
  keywords: ['нажать действие', 'кнопка письма', 'press action', 'ознакомить'],
  module: 'letters',
  kind: 'write',
  featureFlag: 'correspondence',
  hot: false,
  input: pressInput,
  api: { method: 'POST', path: '/letters/:id/actions/:actionId/press' },
  build: (input) => ({
    method: 'POST',
    path: `/letters/${input.letterId}/actions/${input.actionId}/press`,
    body: {
      ...(input.override !== undefined ? { override: input.override } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.form ? { form: input.form } : {}),
    },
  }),
  project: (data) => ({
    text: successText(data, 'Действие выполнено'),
    entity: letterEntity(data),
  }),
  card: {
    title: 'Нажать действие письма',
    summary: async (input, ctx) => {
      const [letter, action] = await Promise.all([
        letterLabel(ctx, input.letterId),
        actionName(ctx, input.letterId, input.actionId),
      ]);
      return `${action ?? 'действие'} → ${letter ?? shortId(input.letterId)}`;
    },
    fields: async (input, ctx) =>
      fieldsOf([
        field('Письмо', await letterLabel(ctx, input.letterId)),
        field('Действие', await actionName(ctx, input.letterId, input.actionId)),
        field('Окно', formValues(input.form)),
        field('Обход блокировки', input.override ? 'да' : null),
        field('Причина', input.reason ? clip(input.reason, 300) : null),
      ]),
    consequences:
      'Действие зафиксируется в истории письма; статус письма не изменится. Автоматической отмены нет.',
  },
});

async function actionName(
  ctx: ToolContext,
  letterId: string,
  actionId: string,
): Promise<string | null> {
  if (!ctx.read) return null;
  try {
    for (const raw of asArray(await ctx.read(`/letters/${letterId}/actions`))) {
      const action = asRecord(raw);
      if (str(action?.id) === actionId) return str(action?.name);
    }
  } catch {
    return null;
  }
  return null;
}
export const lettersRelationsActionsTools = [lettersAddRelationTool, lettersPressActionTool];
