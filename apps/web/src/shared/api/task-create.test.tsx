// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCreateTask } from './task-create.js';
import { useAssigneeTasks, userRelationsKeys } from './user-relations.js';

/** #1036: создание задачи обязано помечать устаревшими списки «от человека» —
 *  вкладку и счётчик карточки сотрудника, включая search-ветку. */

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCreateTask — инвалидация вкладки карточки сотрудника (#1036)', () => {
  it('после создания ветка tasks/assignee (с поиском) помечается устаревшей', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 't-1', title: 'Новая' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const canonical = userRelationsKeys.tasks('u-1');
    const searched = userRelationsKeys.tasks('u-1', 'Новая');
    client.setQueryData(canonical, { items: [], nextCursor: null });
    client.setQueryData(searched, { items: [], nextCursor: null });

    const { result } = renderHook(() => useCreateTask(), { wrapper: wrapper(client) });
    act(() => result.current.mutate({ title: 'Новая', assigneeId: 'u-1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryState(canonical)?.isInvalidated).toBe(true);
    expect(client.getQueryState(searched)?.isInvalidated).toBe(true);
  });

  it('журнал вкладки перечитывается после создания без ремаунта', async () => {
    let created = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith('/tasks')) {
          created = true;
          return new Response(JSON.stringify({ id: 't-1', title: 'Новая' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/tasks?assigneeId=')) {
          return new Response(
            JSON.stringify({
              items: created ? [{ id: 't-1', title: 'Новая' }] : [],
              nextCursor: null,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(
      () => ({ list: useAssigneeTasks('u-1'), create: useCreateTask() }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.list.data?.items).toHaveLength(0);

    act(() => result.current.create.mutate({ title: 'Новая', assigneeId: 'u-1' }));
    await waitFor(() => expect(result.current.list.data?.items).toHaveLength(1));
  });
});
