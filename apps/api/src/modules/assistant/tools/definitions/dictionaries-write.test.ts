import { describe, expect, it, vi } from 'vitest';

import { Permission } from '@nodus/contracts';

import { buildCatalog } from '../catalog.js';
import type { ToolContext } from '../tool-definition.js';
import {
  dictionariesItemCreateTool,
  dictionariesItemUpdateTool,
} from './dictionaries-write.tools.js';

/** #932: запись вариантов справочников — тело, карточка, право. */

const I = '5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a';

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: vi.fn(async (path: string) => {
    if (path === '/dictionaries/document-kind/items?limit=100&includeArchived=true')
      return { items: [{ id: I, name: 'Договор подряда', isActive: true }], nextCursor: null };
    return null;
  }),
};

describe('добавление варианта справочника', () => {
  it('тело и карточка называют справочник и вариант', async () => {
    const input = { dictionaryCode: 'document-kind', item: { name: 'Договор субподряда' } };
    expect(dictionariesItemCreateTool.build!(input)).toEqual({
      method: 'POST',
      path: '/dictionaries/document-kind/items',
      body: { name: 'Договор субподряда' },
    });
    expect(await dictionariesItemCreateTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([
        { label: 'Справочник', value: 'document-kind' },
        { label: 'Новый вариант', value: 'Договор субподряда' },
      ]),
    );
  });
});

describe('правка варианта справочника', () => {
  it('патч уходит в тело, карточка показывает текущее имя', async () => {
    const input = {
      dictionaryCode: 'document-kind',
      itemId: I,
      patch: { name: 'Договор генподряда' },
    };
    expect(dictionariesItemUpdateTool.build!(input)).toEqual({
      method: 'PATCH',
      path: `/dictionaries/document-kind/items/${I}`,
      body: { name: 'Договор генподряда' },
    });
    expect(await dictionariesItemUpdateTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([
        { label: 'Вариант', value: 'Договор подряда' },
        { label: 'Новое название', value: 'Договор генподряда' },
      ]),
    );
  });

  it('цвет показывается человеческим словом, null — «убрать цвет»', async () => {
    const input = { dictionaryCode: 'document-kind', itemId: I, patch: { color: null } };
    expect(await dictionariesItemUpdateTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([{ label: 'Новый цвет', value: 'убрать цвет' }]),
    );
  });

  it('пустой патч отклоняется, без права dictionary.manage инструментов нет', () => {
    expect(
      dictionariesItemUpdateTool.input.safeParse({
        dictionaryCode: 'document-kind',
        itemId: I,
        patch: {},
      }).success,
    ).toBe(false);
    expect(dictionariesItemUpdateTool.permission).toBe(Permission.DICTIONARY_MANAGE);
    const without = buildCatalog({ permissions: ['assistant.use'], features: [] });
    expect(without.some((tool) => tool.id.startsWith('dictionaries.item_'))).toBe(false);
    const withRight = buildCatalog({
      permissions: ['assistant.use', Permission.DICTIONARY_MANAGE],
      features: [],
    });
    expect(withRight.some((tool) => tool.id === 'dictionaries.item_create')).toBe(true);
  });
});
