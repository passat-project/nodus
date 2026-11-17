import { z } from 'zod';

import type { Dictionary, DictionaryItem, Paginated } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asArray, asTyped, finalize, hasMore, listBlock, num, str } from '../projections.js';

/**
 * Инструменты справочников (I15, #892): список бизнес-списков портала и
 * элементы конкретного справочника. Это данные компании (типы документов,
 * причины, категории) — модель обязана брать варианты отсюда, а не выдумывать.
 */

const listInput = z.object({ limit: z.number().int().min(1).max(50).default(30) });

export const dictionariesListTool = defineTool({
  id: 'dictionaries.list',
  title: 'Справочники: список',
  description:
    'Справочники портала (бизнес-списки): код, название, иерархичность. Код нужен для dictionaries.items.',
  keywords: ['справочники', 'списки', 'классификаторы', 'варианты', 'dictionaries'],
  module: 'dictionaries',
  kind: 'read',
  hot: true,
  input: listInput,
  api: { method: 'GET', path: '/dictionaries' },
  build: (input) => ({ path: '/dictionaries', query: { limit: String(input.limit) } }),
  project: (data: Paginated<Dictionary>) => {
    const rows = asArray(data.items).map((raw) => {
      const dictionary = asTyped<Dictionary>(raw);
      if (!dictionary) return null;
      return `«${str(dictionary.name) ?? '—'}» — код ${str(dictionary.code) ?? '—'}${dictionary.hierarchical ? ', иерархический' : ''}`;
    });
    return {
      text: finalize(
        listBlock(
          'Справочники',
          rows.filter((row): row is string => row !== null),
          {
            maxRows: 40,
            more: hasMore(data),
          },
        ),
      ),
    };
  },
});

const itemsInput = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Код справочника — латиница в нижнем регистре через дефис'),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(40),
});

export const dictionariesItemsTool = defineTool({
  id: 'dictionaries.items',
  title: 'Справочники: элементы',
  description:
    'Элементы справочника по коду: названия вариантов, сортировка, архивные. Используй, чтобы назвать вариант так, как он записан в портале.',
  keywords: ['элементы', 'варианты', 'значения', 'справочник', 'items'],
  module: 'dictionaries',
  kind: 'read',
  hot: true,
  input: itemsInput,
  api: { method: 'GET', path: '/dictionaries/:code/items' },
  build: (input) => ({
    path: `/dictionaries/${input.code}/items`,
    query: { limit: String(input.limit), includeArchived: String(input.includeArchived) },
  }),
  project: (data: Paginated<DictionaryItem>) => {
    const rows = asArray(data.items).map((raw) => {
      const item = asTyped<DictionaryItem>(raw);
      if (!item) return null;
      const archived = item.isActive === false;
      return `${str(item.name) ?? '—'}${str(item.code) ? ` (${str(item.code)})` : ''}${archived ? ' — архивный' : ''}${num(item.sortOrder) !== null ? `, порядок ${num(item.sortOrder)}` : ''}`;
    });
    return {
      text: finalize(
        listBlock(
          'Элементы справочника',
          rows.filter((row): row is string => row !== null),
          {
            maxRows: 40,
            more: hasMore(data),
          },
        ),
      ),
    };
  },
});

export const dictionariesTools = [dictionariesListTool, dictionariesItemsTool];
