// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CounterpartyCard, CounterpartyListItem, Paginated } from '@nodus/contracts';

import { counterpartiesKeys } from './keys.js';
import { useCreateCounterparty } from './mutations.js';

const ID = '70000000-0000-4000-8000-000000000001';
const OTHER = '70000000-0000-4000-8000-000000000002';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client } satisfies QueryClientProviderProps,
      children,
    );
  };
}

/** Контролируемый deferred: ответ сервера отпускаем вручную (I4-тест без миллисекунд). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const existing: CounterpartyListItem = {
  id: OTHER,
  fullName: 'ООО «Существующий»',
  shortName: 'ООО «Существующий»',
  unp: null,
  address: null,
  email: null,
  phone: null,
  lettersCount: 0,
  projectsCount: 0,
  contactsCount: 0,
  archivedAt: null,
};

const card: CounterpartyCard = {
  id: ID,
  fullName: 'ООО «Новый»',
  shortName: 'ООО «Новый»',
  unp: '100123456',
  address: null,
  email: null,
  phone: null,
  customFields: {},
  lettersCount: 0,
  projectsCount: 0,
  contactPersons: [],
  archivedAt: null,
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
};

const pagesKey = counterpartiesKeys.pages({ includeArchived: false });
const pagesKeySearch = counterpartiesKeys.pages({ search: 'новый', includeArchived: false });

function seed(client: QueryClient) {
  const pages: InfiniteData<Paginated<CounterpartyListItem>, string | null> = {
    pages: [{ items: [existing], nextCursor: null }],
    pageParams: [null],
  };
  client.setQueryData(pagesKey, pages);
  client.setQueryData(pagesKeySearch, {
    pages: [{ items: [], nextCursor: null }],
    pageParams: [null],
  });
}

function items(client: QueryClient, key: readonly unknown[]): CounterpartyListItem[] {
  return (
    client.getQueryData<InfiniteData<Paginated<CounterpartyListItem>>>(key)?.pages[0]?.items ?? []
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCreateCounterparty: оптимистичное создание (I4)', () => {
  it('временная запись — в первой странице ДО ответа, затем заменяется серверной', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gate.promise),
    );
    const { result } = renderHook(() => useCreateCounterparty(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({
        fullName: 'ООО «Новый»',
        shortName: 'ООО «Новый»',
        unp: '100123456',
      });
    });

    const optimistic = items(client, pagesKey);
    expect(optimistic).toHaveLength(2);
    expect(optimistic[0]).toMatchObject({ fullName: 'ООО «Новый»', unp: '100123456' });
    expect(optimistic[0]?.id.startsWith('temp-')).toBe(true);
    // В кэш поиска «новый» запись тоже попала (совпадает фильтру).
    expect(items(client, pagesKeySearch)[0]?.fullName).toBe('ООО «Новый»');

    await act(async () => {
      gate.resolve(jsonResponse(201, card));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const settled = items(client, pagesKey);
    expect(settled[0]).toMatchObject({ id: ID, shortName: 'ООО «Новый»' });
    expect(settled.some((row) => row.id.startsWith('temp-'))).toBe(false);
    expect(client.getQueryData(counterpartiesKeys.detail(ID))).toMatchObject({ id: ID });
  });

  it('ошибка сервера — откат по снапшоту (временная запись исчезает)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gate.promise),
    );
    const { result } = renderHook(() => useCreateCounterparty(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({ fullName: 'ООО «Дубль»', shortName: 'ООО «Дубль»', unp: null });
    });
    expect(items(client, pagesKey)).toHaveLength(2);

    await act(async () => {
      gate.resolve(jsonResponse(409, { code: 'CRM_UNP_TAKEN', message: 'taken' }));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(items(client, pagesKey)).toEqual([existing]);
    expect(items(client, pagesKeySearch)).toEqual([]);
  });
});
