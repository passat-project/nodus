// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { tasksKeys, usePrefetchTask, useTasksPages } from './tasks-api.js';

const TASK_ID = '30000000-0000-4000-8000-000000000002';

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

/**
 * A6-3 (#632): префетч детали по ховеру шёл в сеть на КАЖДЫЙ pointerenter —
 * без staleTime кэш считался протухшим сразу, троттла не было вовсе.
 * Наведение на список из сотни строк превращалось в поток GET /tasks/:id.
 */
describe('usePrefetchTask: ховер не превращается в поток GET (A6-3)', () => {
  it('повторный префетч того же id в окне не зовёт queryFn — даже после инвалидации', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: TASK_ID }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePrefetchTask(), { wrapper: makeWrapper(client) });
    await act(async () => {
      result.current(TASK_ID);
    });
    await waitFor(() => expect(client.getQueryData(tasksKeys.detail(TASK_ID))).toBeDefined());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Повторное наведение: данные свежи (staleTime префетча) — сети нет.
    await act(async () => {
      result.current(TASK_ID);
      result.current(TASK_ID);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Инвалидация пометила деталь stale: без троттла следующий ховер снова
    // пошёл бы в сеть — окно повтора это гасит.
    await client.invalidateQueries({ queryKey: tasksKeys.detail(TASK_ID) });
    await act(async () => {
      result.current(TASK_ID);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('за окном повтора префетч снова запрашивает деталь', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: TASK_ID }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePrefetchTask(), { wrapper: makeWrapper(client) });
    await act(async () => {
      result.current(TASK_ID);
    });
    await waitFor(() => expect(client.getQueryData(tasksKeys.detail(TASK_ID))).toBeDefined());

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    try {
      await client.invalidateQueries({ queryKey: tasksKeys.detail(TASK_ID) });
      await act(async () => {
        result.current(TASK_ID);
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('useTasksPages — серверный поиск (#956)', () => {
  it('передаёт search в /tasks и в ключ кэша журнала', async () => {
    const fetchMock = vi.fn().mockImplementation(async (...args: unknown[]) => {
      void args;
      return jsonResponse(200, { items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useTasksPages('mine', undefined, 'ПП-12'), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/tasks?view=list&scope=mine&limit=100');
    expect(url).toContain(`search=${encodeURIComponent('ПП-12')}`);
    expect(tasksKeys.listPages({ search: 'ПП-12' })).toEqual([
      ...tasksKeys.all,
      'list-pages',
      { search: 'ПП-12' },
    ]);
  });
});
