import { describe, expect, it, vi } from 'vitest';

import { DictionariesRepository } from './dictionaries.repository.js';

/**
 * Репозиторий справочников (Р6 #631): цвет варианта нормализуется к
 * палитре темы на каждом чтении/записи — чужой ключ из БД читается как
 * «без цвета», чипы не ломаются. Правка варианта — имя и/или цвет.
 */

const DICT_ID = '00000000-0000-4000-8000-0000000000d1';
const ITEM_ID = '00000000-0000-4000-8000-0000000000d2';

const row = (overrides: Record<string, unknown> = {}) => ({
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
  const dictionaryItem = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const repo = new DictionariesRepository({ dictionaryItem } as never);
  const tx = { dictionaryItem } as never;
  return { repo, dictionaryItem, tx };
}

describe('DictionariesRepository: нормализация цвета (Р6 #631)', () => {
  it('listItems: валидный тон проходит, чужой ключ — null', async () => {
    const { repo, dictionaryItem } = make();
    dictionaryItem.findMany.mockResolvedValue([row({ color: 'teal' }), row({ color: 'crimson' })]);
    const items = await repo.listItems(DICT_ID, { includeArchived: false, limit: 50, after: null });
    expect(items.map((i) => i.color)).toEqual(['teal', null]);
  });

  it('findItemById: найден — нормализован, нет — null', async () => {
    const { repo, dictionaryItem } = make();
    dictionaryItem.findUnique.mockResolvedValueOnce(row({ color: 'pink' }));
    expect(await repo.findItemById(ITEM_ID)).toMatchObject({ id: ITEM_ID, color: 'pink' });
    dictionaryItem.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findItemById(ITEM_ID)).toBeNull();
  });

  it('createItem/updateItem пишут данные и нормализуют ответ', async () => {
    const { repo, dictionaryItem, tx } = make();
    dictionaryItem.create.mockResolvedValueOnce(row({ color: 'bogus' }));
    const created = await repo.createItem(
      { dictionaryId: DICT_ID, name: 'Кирпич', code: null, sortOrder: 1, color: 'bogus' },
      tx,
    );
    expect(created.color).toBeNull();
    expect(dictionaryItem.create).toHaveBeenCalledWith({
      data: { dictionaryId: DICT_ID, name: 'Кирпич', code: null, sortOrder: 1, color: 'bogus' },
      select: expect.anything(),
    });

    dictionaryItem.update.mockResolvedValueOnce(row({ color: 'teal', name: 'Бетон' }));
    const updated = await repo.updateItem(ITEM_ID, { name: 'Бетон', color: 'teal' }, tx);
    expect(updated).toMatchObject({ name: 'Бетон', color: 'teal' });
    expect(dictionaryItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { name: 'Бетон', color: 'teal' },
      select: expect.anything(),
    });
  });

  it('findItemRefs: пустой ввод — без запроса; строки — с цветом и нормализацией', async () => {
    const { repo, dictionaryItem } = make();
    expect(await repo.findItemRefs([])).toEqual([]);
    expect(dictionaryItem.findMany).not.toHaveBeenCalled();

    dictionaryItem.findMany.mockResolvedValueOnce([
      row({ color: 'neutral' }),
      row({ color: 'nope' }),
    ]);
    const refs = await repo.findItemRefs([ITEM_ID]);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.color)).toEqual(['neutral', null]);
    expect(dictionaryItem.findMany).toHaveBeenCalledWith({
      where: { id: { in: [ITEM_ID] } },
      select: { id: true, dictionaryId: true, name: true, code: true, isActive: true, color: true },
    });
  });

  it('findActiveItemRef: найден — нормализован, нет — null', async () => {
    const { repo, dictionaryItem } = make();
    dictionaryItem.findFirst.mockResolvedValueOnce(row({ color: 'info' }));
    expect(await repo.findActiveItemRef(DICT_ID, ITEM_ID)).toMatchObject({ color: 'info' });
    dictionaryItem.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findActiveItemRef(DICT_ID, ITEM_ID)).toBeNull();
  });
});
