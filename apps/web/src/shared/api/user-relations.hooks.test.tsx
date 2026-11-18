// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useAssigneeTasks, useMemberProjects, userRelationsKeys } from './user-relations.js';

/** #956: поиск в журналах карточки сотрудника — серверный: хук обязан
 *  отдать `search` в URL и держать его отдельной веткой кэша (иначе выдача
 *  подменялась бы загруженной страницей). */

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

describe('useAssigneeTasks — серверный поиск (#956)', () => {
  it('search уходит в /tasks и в ключ кэша; пустой — канонический URL', async () => {
    const fetchMock = vi.fn().mockImplementation(async (...args: unknown[]) => {
      void args;
      return jsonResponse({ items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useAssigneeTasks('u-1', 'ПП-12'), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/tasks?assigneeId=u-1&scope=all&limit=100');
    expect(url).toContain(`search=${encodeURIComponent('ПП-12')}`);
    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual(
      userRelationsKeys.tasks('u-1', 'ПП-12'),
    );
  });

  it('пустой запрос не добавляет search', async () => {
    const fetchMock = vi.fn().mockImplementation(async (...args: unknown[]) => {
      void args;
      return jsonResponse({ items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useAssigneeTasks('u-1', '   '), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('search=');
    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual(userRelationsKeys.tasks('u-1'));
  });
});

describe('useMemberProjects — серверный поиск (#956)', () => {
  it('search уходит в /projects и в ключ кэша', async () => {
    const fetchMock = vi.fn().mockImplementation(async (...args: unknown[]) => {
      void args;
      return jsonResponse({ items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(
      () => useMemberProjects('u-1', { enabled: true, search: 'Смета' }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/projects?memberId=u-1&scope=all&limit=100');
    expect(url).toContain(`search=${encodeURIComponent('Смета')}`);
    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual(
      userRelationsKeys.projects('u-1', 'Смета'),
    );
  });

  it('enabled: false — запрос не уходит (домен проектов выключен)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useMemberProjects('u-1', { enabled: false, search: 'Смета' }), {
      wrapper: wrapper(client),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
