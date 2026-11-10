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

import { counterpartiesKeys } from '../../../shared/counterparties/keys.js';
import { useSetCounterpartyArchived, useUpdateCounterparty } from './counterparty-edit.js';

/**
 * Регрессия бага 25.10.2026: патч списка в onMutate обращался к `data.items`
 * у InfiniteData (`{ pages, pageParams }`) → TypeError ДО запроса, мутация
 * падала с «Не удалось отправить», архив не срабатывал ни из карточки,
 * ни из меню строки.
 */

const ID = '70000000-0000-4000-8000-000000000001';

const item: CounterpartyListItem = {
  id: ID,
  fullName: 'ООО «Тест»',
  shortName: 'ООО «Тест»',
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
  ...item,
  customFields: {},
  contactPersons: [],
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
};

const pagesKey = counterpartiesKeys.pages({ includeArchived: false });

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

function seed(client: QueryClient) {
  const pages: InfiniteData<Paginated<CounterpartyListItem>, string | null> = {
    pages: [{ items: [item], nextCursor: null }],
    pageParams: [null],
  };
  client.setQueryData(pagesKey, pages);
  client.setQueryData(counterpartiesKeys.detail(ID), card);
}

function firstItem(client: QueryClient): CounterpartyListItem | undefined {
  return client.getQueryData<InfiniteData<Paginated<CounterpartyListItem>>>(pagesKey)?.pages[0]
    ?.items[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('патч списка в onMutate не падает на InfiniteData (баг 25.10.2026)', () => {
  it('архив: строка реестра помечается ДО ответа, запрос уходит', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      jsonResponse(200, { ...card, archivedAt: '2026-10-25T12:00:00.000Z' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSetCounterpartyArchived(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ id: ID, archived: true });
    });

    // Запрос реально ушёл (до фикса мутация падала в onMutate).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/counterparties/${ID}/archive`);
    expect(firstItem(client)?.archivedAt).not.toBeNull();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('правка реквизитов: строка реестра обновляется, ошибки в onMutate нет', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);
    const fetchMock = vi.fn(async () => jsonResponse(200, { ...card, phone: '+375 17 000-00-00' }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useUpdateCounterparty(ID), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ phone: '+375 17 000-00-00' });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstItem(client)?.phone).toBe('+375 17 000-00-00');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
