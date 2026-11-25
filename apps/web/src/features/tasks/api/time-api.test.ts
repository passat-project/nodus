// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Paginated, TimeEntry } from '@nodus/contracts';

const api = vi.hoisted(() => vi.fn());

vi.mock('../../../shared/api-client.js', () => ({
  api,
  ApiError: class ApiError extends Error {},
}));

import { useTimeEntries } from './time-api.js';

const ENTRY = (id: string): TimeEntry =>
  ({
    id,
    taskId: 'task-1',
    userId: 'u1',
    user: { id: 'u1', displayName: 'Автор', avatarUrl: null },
    minutes: 30,
    date: '2026-11-25',
    method: 'manual',
    comment: null,
    startedAt: null,
    endedAt: null,
  }) as never;

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

/** #1032: «Затрачено» листает по курсору — старые записи не теряются. */
describe('useTimeEntries: пагинация (#1032)', () => {
  it('первая страница — limit=100; следующая просит cursor и складывает страницы', async () => {
    api.mockImplementation(async (url: string): Promise<Paginated<TimeEntry>> => {
      if (url.includes('cursor=c1')) {
        return { items: [ENTRY('e-2')], nextCursor: null };
      }
      return { items: [ENTRY('e-1')], nextCursor: 'c1' };
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useTimeEntries('task-1'), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api).toHaveBeenCalledWith('/tasks/task-1/time-entries?limit=100');
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();

    expect(api).toHaveBeenLastCalledWith('/tasks/task-1/time-entries?limit=100&cursor=c1');
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    const ids = result.current.data?.pages.flatMap((page) => page.items.map((e) => e.id));
    expect(ids).toEqual(['e-1', 'e-2']);
  });
});
