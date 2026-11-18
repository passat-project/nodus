// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { useProjectTaskPages } from './projects-api.js';

/**
 * #956: журнал задач проекта — курсорный и пагинированный, поэтому поиск
 * серверный: `search` идёт в URL фида и в отдельную ветку ключа кэша, иначе
 * фильтр видел бы только загруженную страницу. Лента проекта живёт под общим
 * префиксом журнала задач (`tasksKeys.listPages`) — кэш общий с карточкой.
 */

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

describe('useProjectTaskPages — серверный поиск (#956)', () => {
  it('search уходит в /tasks и в ветку ключа журнала', async () => {
    const fetchMock = vi.fn().mockImplementation(async (...args: unknown[]) => {
      void args;
      return jsonResponse({ items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useProjectTaskPages('p-1', 'Смета'), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/tasks?projectId=p-1&scope=all&limit=100');
    expect(url).toContain(`search=${encodeURIComponent('Смета')}`);
    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual(
      tasksKeys.listPages({ projectId: 'p-1', scope: 'all', search: 'Смета' }),
    );
  });

  it('пустой поиск — канонический ключ и URL без search', async () => {
    const fetchMock = vi.fn().mockImplementation(async (...args: unknown[]) => {
      void args;
      return jsonResponse({ items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useProjectTaskPages('p-1', '  '), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('search=');
    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual(
      tasksKeys.listPages({ projectId: 'p-1', scope: 'all' }),
    );
  });
});
