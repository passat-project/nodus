// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dictionary, DictionaryItem } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { commitOptionDrafts, useCreateDictionary } from './dictionaries-api.js';
import { dictionariesKeys } from '../../../shared/dictionaries/keys.js';

/** Черновик вариантов атрибута-списка (#431, Р6 #631): применение к
 *  справочнику — удалить → переименовать/перекрасить → добавить → порядок;
 *  правка шлёт только изменённые ключи, порядок — только при изменении. */
vi.mock('../../../shared/api-client.js', () => ({ api: vi.fn() }));

const { api } = await import('../../../shared/api-client.js');
const calls = vi.mocked(api);

beforeEach(() => {
  calls.mockReset();
});

const CODE = 'cf-10000000-0000-4000-8000-000000000001';
const BASE = `/dictionaries/${CODE}/items`;

function item(id: string, name: string, color: DictionaryItem['color'] = null): DictionaryItem {
  return {
    id,
    dictionaryId: '10000000-0000-4000-8000-000000000001',
    parentId: null,
    code: null,
    name,
    color,
    sortOrder: 0,
    isActive: true,
  };
}

function lastBodies(method: string, url: string): unknown[] {
  return calls.mock.calls
    .filter(([path, options]) => path === url && options?.method === method)
    .map(([, options]) => options?.body);
}

describe('commitOptionDrafts', () => {
  it('полный конвейер: удалить → править изменённое → добавить → порядок', async () => {
    calls.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST' && url === BASE) return item('new-1', 'Новый вариант');
      return undefined as never;
    });

    const map = await commitOptionDrafts(
      CODE,
      [item('a', 'Стадия', null), item('b', 'Рабочка', 'info'), item('c', 'Лишнее')],
      [
        { id: 'a', name: 'Стадия П', color: null }, // переименование
        { id: 'b', name: 'Рабочка', color: null }, // только цвет → null
        { id: 'draft:1', name: 'Новый вариант', color: null }, // новый
      ],
    );

    // Удалённый вариант стирается.
    expect(calls).toHaveBeenCalledWith(`${BASE}/c`, { method: 'DELETE' });
    // Правка — только изменённые ключи.
    expect(calls).toHaveBeenCalledWith(`${BASE}/a`, {
      method: 'PATCH',
      body: { name: 'Стадия П' },
    });
    expect(calls).toHaveBeenCalledWith(`${BASE}/b`, { method: 'PATCH', body: { color: null } });
    // Добавление — имя нового варианта; отображение временного id.
    expect(calls).toHaveBeenCalledWith(BASE, { method: 'POST', body: { name: 'Новый вариант' } });
    expect(map.get('draft:1')).toBe('new-1');
    expect(map.size).toBe(1);
    // Порядок изменился (добавлен вариант) — PUT порядка.
    expect(calls).toHaveBeenCalledWith(`${BASE}/order`, {
      method: 'PUT',
      body: { ids: ['a', 'b', 'new-1'] },
    });
  });

  it('без изменений — ни одного запроса, кроме чтения порядка', async () => {
    await commitOptionDrafts(
      CODE,
      [item('a', 'Один'), item('b', 'Два')],
      [
        { id: 'a', name: 'Один', color: null },
        { id: 'b', name: 'Два', color: null },
      ],
    );

    expect(calls).not.toHaveBeenCalled();
  });

  it('тот же состав в новом порядке — только PUT порядка', async () => {
    await commitOptionDrafts(
      CODE,
      [item('a', 'Один'), item('b', 'Два')],
      [
        { id: 'b', name: 'Два', color: null },
        { id: 'a', name: 'Один', color: null },
      ],
    );

    expect(calls.mock.calls.filter(([url]) => url.startsWith(BASE)).map(([url]) => url)).toEqual([
      `${BASE}/order`,
    ]);
    expect(calls).toHaveBeenCalledWith(`${BASE}/order`, {
      method: 'PUT',
      body: { ids: ['b', 'a'] },
    });
  });

  it('пустой справочник — нет PUT порядка', async () => {
    const map = await commitOptionDrafts(CODE, [], []);
    expect(map.size).toBe(0);
    expect(lastBodies('PUT', `${BASE}/order`)).toEqual([]);
  });

  it('удалённое имя можно занять новым вариантом в одном применении', async () => {
    calls.mockImplementation(async () => item('reborn', 'Вариант') as never);

    const map = await commitOptionDrafts(
      CODE,
      [item('old', 'Вариант')],
      [{ id: 'draft:2', name: 'Вариант', color: null }],
    );

    expect(calls).toHaveBeenCalledWith(`${BASE}/old`, { method: 'DELETE' });
    expect(map.get('draft:2')).toBe('reborn');
    // Удалённый выпал из прежнего порядка — состав изменился, порядок пишется.
    expect(lastBodies('PUT', `${BASE}/order`)).toEqual([{ ids: ['reborn'] }]);
  });
});

describe('useCreateDictionary', () => {
  it('создаёт справочник и инвалидирует кэш справочников', async () => {
    const created: Dictionary = {
      id: '10000000-0000-4000-8000-000000000009',
      code: 'new-dict',
      name: 'Виды работ',
      hierarchical: false,
      isSystem: false,
    };
    calls.mockImplementation(async () => created as never);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(dictionariesKeys.list(), [created]);
    const { result } = renderHook(() => useCreateDictionary(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    result.current.mutate({ name: 'Виды работ' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(created);
    expect(calls).toHaveBeenCalledWith('/dictionaries', {
      method: 'POST',
      body: { name: 'Виды работ' },
    });
    expect(client.getQueryState(dictionariesKeys.list())?.isInvalidated).toBe(true);
  });
});
