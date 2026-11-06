import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARY_EVENTS, ErrorCode } from '@nodus/contracts';

import { DictionaryItemsService } from './dictionary-items.service.js';

/**
 * Мутации вариантов справочников (#431; Р6 #631 — PATCH цвета): правка
 * варианта без переименования, no-op без события, уникальность имени под
 * локом. Системный справочник закрыт для любой правки вариантов.
 */

const DICT_ID = '00000000-0000-4000-8000-0000000000d1';
const ITEM_ID = '00000000-0000-4000-8000-0000000000d2';
const ACTOR = '00000000-0000-4000-8000-0000000000d3';

const DICT = { id: DICT_ID, code: 'list-1', name: 'Марки', hierarchical: false, isSystem: false };

const item = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM_ID,
  dictionaryId: DICT_ID,
  parentId: null,
  code: null,
  name: 'Кирпич',
  color: null,
  sortOrder: 0,
  isActive: true,
  ...overrides,
});

function make() {
  const dictionaries = {
    findDictionaryByCode: vi.fn(async () => DICT),
    lockDictionary: vi.fn(async () => undefined),
    findItemById: vi.fn(async () => item()),
    findActiveItemByName: vi.fn(async () => null as { id: string } | null),
    updateItem: vi.fn(async (_id: string, data: Record<string, unknown>) => item(data)),
  };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const service = new DictionaryItemsService(
    dictionaries as never,
    txRunner as never,
    eventBus as never,
  );
  return { service, dictionaries, eventBus };
}

describe('DictionaryItemsService.updateItem (Р6 #631)', () => {
  let kit: ReturnType<typeof make>;
  beforeEach(() => {
    kit = make();
  });

  it('переименование на занятое имя — 409 DICTIONARY_ITEM_NAME_TAKEN', async () => {
    kit.dictionaries.findActiveItemByName.mockResolvedValue({ id: 'other' });
    await expect(
      kit.service.updateItem('list-1', ITEM_ID, { name: 'Бетон' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.DICTIONARY_ITEM_NAME_TAKEN });
    expect(kit.dictionaries.updateItem).not.toHaveBeenCalled();
  });

  it('no-op без события: то же имя без цвета и то же имя с тем же цветом', async () => {
    const first = await kit.service.updateItem('list-1', ITEM_ID, { name: 'Кирпич' }, ACTOR);
    expect(first).toEqual(item());
    expect(kit.dictionaries.updateItem).not.toHaveBeenCalled();
    expect(kit.eventBus.emit).not.toHaveBeenCalled();

    const same = await kit.service.updateItem(
      'list-1',
      ITEM_ID,
      { name: 'Кирпич', color: null },
      ACTOR,
    );
    expect(same).toEqual(item());
    expect(kit.eventBus.emit).not.toHaveBeenCalled();
  });

  it('цвет без переименования — PATCH только цвета, событие fields: [color]', async () => {
    const updated = await kit.service.updateItem('list-1', ITEM_ID, { color: 'teal' }, ACTOR);
    expect(updated.color).toBe('teal');
    expect(kit.dictionaries.updateItem).toHaveBeenCalledWith(
      ITEM_ID,
      { color: 'teal' },
      expect.anything(),
    );
    expect(kit.eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      DICTIONARY_EVENTS.ITEM_UPDATED,
      { dictionaryId: DICT_ID, itemId: ITEM_ID, fields: ['color'] },
      { actorId: ACTOR, aggregateType: 'dictionary', aggregateId: DICT_ID },
    );
  });

  it('переименование с цветом — оба поля в патче и в событии', async () => {
    await kit.service.updateItem('list-1', ITEM_ID, { name: 'Бетон', color: 'pink' }, ACTOR);
    expect(kit.dictionaries.updateItem).toHaveBeenCalledWith(
      ITEM_ID,
      { name: 'Бетон', color: 'pink' },
      expect.anything(),
    );
    expect(kit.eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      DICTIONARY_EVENTS.ITEM_UPDATED,
      { dictionaryId: DICT_ID, itemId: ITEM_ID, fields: ['name', 'color'] },
      expect.anything(),
    );
  });

  it('чужой элемент (другой справочник) — 404', async () => {
    kit.dictionaries.findItemById.mockResolvedValue(item({ dictionaryId: 'other-dict' }));
    await expect(
      kit.service.updateItem('list-1', ITEM_ID, { name: 'Бетон' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('системный справочник закрыт — 409 DICTIONARY_SYSTEM_LOCKED', async () => {
    kit.dictionaries.findDictionaryByCode.mockResolvedValue({ ...DICT, isSystem: true });
    await expect(
      kit.service.updateItem('list-1', ITEM_ID, { color: 'teal' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.DICTIONARY_SYSTEM_LOCKED });
  });
});
