import { z } from 'zod';

import {
  Permission,
  createDictionaryItemBodySchema,
  updateDictionaryItemBodySchema,
  type DictionaryItem,
  type Paginated,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asTyped, pageItems } from '../projections.js';
import { field, fieldsOf, shortId } from './write-cards.js';
import { dictionariesWriteMeta } from './meta/dictionaries-write.meta.js';

/**
 * Запись справочников (#932): новый вариант и правка варианта. Минимальная
 * запись бизнес-списков (I15) — через карточку подтверждения (ADR-0048);
 * создание и удаление самих справочников, массовые операции — не для
 * ассистента (решение владельца).
 */

const COLOR_LABEL: Record<string, string> = {
  neutral: 'нейтральный',
  info: 'синий',
  success: 'зелёный',
  warning: 'жёлтый',
  danger: 'красный',
  violet: 'фиолетовый',
  teal: 'бирюзовый',
  orange: 'оранжевый',
  pink: 'розовый',
  cyan: 'голубой',
};

async function itemLabel(
  ctx: ToolContext,
  dictionaryCode: string,
  itemId: string,
): Promise<string | null> {
  if (!ctx.read) return null;
  try {
    const page = await ctx.read(
      `/dictionaries/${dictionaryCode}/items?limit=100&includeArchived=true`,
    );
    const item = pageItems<DictionaryItem>(page as Paginated<DictionaryItem>).find(
      (candidate) => candidate.id === itemId,
    );
    return item?.name ?? null;
  } catch {
    return null;
  }
}

function itemText(data: unknown, fallback: string): string {
  const item = asTyped<DictionaryItem>(data);
  if (!item?.id) return fallback;
  return `${fallback}: вариант «${item.name}»`;
}

const DICTIONARY_CODE = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Код справочника — латиница в нижнем регистре через дефис');

export const dictionariesItemCreateTool = defineTool({
  ...dictionariesWriteMeta['dictionaries.item_create'],
  id: 'dictionaries.item_create',
  title: 'Справочники: добавить вариант',
  description:
    'Добавить вариант в бизнес-справочник: название, при необходимости код варианта. Код справочника берётся из dictionaries.list. Действие появится карточкой подтверждения.',
  keywords: [
    'добавить вариант',
    'новый вариант справочника',
    'добавить категорию',
    'добавить вид',
    'add dictionary item',
  ],
  module: 'dictionaries',
  kind: 'write',
  permission: Permission.DICTIONARY_MANAGE,
  hot: false,
  input: z.object({ dictionaryCode: DICTIONARY_CODE, item: createDictionaryItemBodySchema }),
  api: { method: 'POST', path: '/dictionaries/:code/items' },
  build: (input) => ({
    method: 'POST',
    path: `/dictionaries/${input.dictionaryCode}/items`,
    body: input.item,
  }),
  project: (data) => ({ text: itemText(data, 'Вариант добавлен в справочник') }),
  card: {
    title: 'Добавить вариант справочника',
    summary: (input) => `Справочник ${input.dictionaryCode}: новый вариант «${input.item.name}»`,
    fields: (input) =>
      fieldsOf([
        field('Справочник', input.dictionaryCode),
        field('Новый вариант', input.item.name),
        field('Код варианта', input.item.code),
      ]),
    consequences:
      'Вариант появится в конце справочника и станет доступен в формах портала. Автоматической отмены нет: удаление варианта — только в интерфейсе.',
  },
});

export const dictionariesItemUpdateTool = defineTool({
  ...dictionariesWriteMeta['dictionaries.item_update'],
  id: 'dictionaries.item_update',
  title: 'Справочники: изменить вариант',
  description:
    'Переименовать вариант справочника или сменить его цвет. Передаются только изменяемые поля; действие появится карточкой подтверждения.',
  keywords: [
    'переименовать вариант',
    'изменить вариант справочника',
    'поменять название категории',
    'цвет варианта',
    'update dictionary item',
  ],
  module: 'dictionaries',
  kind: 'write',
  permission: Permission.DICTIONARY_MANAGE,
  hot: false,
  input: z.object({
    dictionaryCode: DICTIONARY_CODE,
    itemId: z.uuid(),
    patch: updateDictionaryItemBodySchema,
  }),
  api: { method: 'PATCH', path: '/dictionaries/:code/items/:id' },
  build: (input) => ({
    method: 'PATCH',
    path: `/dictionaries/${input.dictionaryCode}/items/${input.itemId}`,
    body: input.patch,
  }),
  project: (data) => ({ text: itemText(data, 'Вариант справочника обновлён') }),
  card: {
    title: 'Изменить вариант справочника',
    summary: async (input, ctx) => {
      const current = await itemLabel(ctx, input.dictionaryCode, input.itemId);
      const changed = Object.keys(input.patch)
        .map((key) => (key === 'name' ? 'название' : 'цвет'))
        .join(', ');
      return `${current ?? shortId(input.itemId)} (${input.dictionaryCode}): ${changed}`;
    },
    fields: async (input, ctx) =>
      fieldsOf([
        field('Справочник', input.dictionaryCode),
        field('Вариант', await itemLabel(ctx, input.dictionaryCode, input.itemId)),
        field('Новое название', input.patch.name),
        field(
          'Новый цвет',
          input.patch.color === null
            ? 'убрать цвет'
            : input.patch.color
              ? (COLOR_LABEL[input.patch.color] ?? input.patch.color)
              : undefined,
        ),
      ]),
    consequences:
      'Вариант обновится во всех формах, где он используется; прежние значения у записей сохранятся. Автоматической отмены нет.',
  },
});

export const dictionariesWriteTools = [dictionariesItemCreateTool, dictionariesItemUpdateTool];
