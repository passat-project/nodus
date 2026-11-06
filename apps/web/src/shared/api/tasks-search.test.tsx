// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TaskListItem } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { useTasksSearch } from './tasks-search.js';
import { tasksKeys } from './tasks-keys.js';

/** Серверный поиск задач (палитра Ctrl+K): пустой запрос не ходит в сеть,
 *  непустой — серверный фильтр с потолком 20, ключ общий с журналом задач. */
const server = setupServer();

function hook(q: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useTasksSearch(q), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useTasksSearch', () => {
  it('пустой запрос — запрос в сеть не уходит', async () => {
    const { result } = hook('');
    // disabled: статус pending, ничего не грузится.
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });

  it('непустой — /tasks?search=…&limit=20', async () => {
    const item = { id: '10000000-0000-4000-8000-000000000001' } as TaskListItem;
    server.use(
      http.get('/api/v1/tasks', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('search')).toBe('школа 340');
        expect(url.searchParams.get('limit')).toBe('20');
        return HttpResponse.json({ items: [item], nextCursor: null });
      }),
    );

    const { result } = hook('школа 340');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([item]);
    expect(tasksKeys.search('школа 340')).toEqual(['tasks', 'search', 'школа 340']);
  });
});
