// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { counterpartyRelationsKeys, useClientProjects } from './counterparty-relations.js';

/** #956: проекты заказчика ищутся серверно — иначе фильтр видел только
 *  загруженную страницу из 100 строк. */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useClientProjects — серверный поиск (#956)', () => {
  it('search уходит в /projects и в ключ кэша', async () => {
    const fetchMock = vi.fn().mockImplementation(async (...args: unknown[]) => {
      void args;
      return jsonResponse({ items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(
      () => useClientProjects('c-1', { enabled: true, search: 'Смета' }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/projects?clientId=c-1&scope=all&limit=100');
    expect(url).toContain(`search=${encodeURIComponent('Смета')}`);
    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual(
      counterpartyRelationsKeys.projects('c-1', 'Смета'),
    );
  });

  it('enabled: false — запрос не уходит', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useClientProjects('c-1', { enabled: false, search: 'Смета' }), {
      wrapper: wrapper(client),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
