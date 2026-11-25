// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { InfiniteData } from '@tanstack/react-query';
import type { Paginated, TaskListItem } from '@nodus/contracts';
import { toast } from 'sonner';

import {
  resetRecentInvalidations,
  wasInvalidatedRecently,
} from '../../../shared/api/task-invalidate.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { useBulkTasks, useDeleteTask, useShiftSubtaskDeadlines } from './task-edit-api.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * Массовые правки задач (#1051): раскладка меняется целиком, поэтому витрины
 * перезапрашиваются сразу и все — но с меткой на каждом ключе: эхо собственных
 * событий ту же волну не повторяет. Прежде «молоток» `tasksKeys.all` шёл
 * дважды — мутацией и её эхом.
 */

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
  resetRecentInvalidations();
});
afterAll(() => server.close());

type InfinitePages = InfiniteData<Paginated<TaskListItem>>;
const PAGES = tasksKeys.listPages();

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<InfinitePages>(PAGES, {
    pages: [{ items: [{ id: 't-1' } as TaskListItem], nextCursor: null }],
    pageParams: [null],
  });
  client.setQueryData(tasksKeys.detail('t-1'), { id: 't-1' });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

/** Один раунд: единственный широкий вызов — префиксом, и журнал помечен. */
const expectStampedRound = (env: ReturnType<typeof setup>) => {
  const wide = env.invalidate.mock.calls.filter(
    ([filters]) => filters?.queryKey !== undefined && filters.queryKey.length === 1,
  );
  expect(wide).toHaveLength(1);
  expect(wide[0]![0]).toEqual({ queryKey: tasksKeys.all });
  expect(wasInvalidatedRecently(PAGES)).toBe(true);
};

describe('массовые правки задач: один раунд (#1051)', () => {
  it('удаление: деталь убрана из кэша, витрины задач — сразу и с меткой', async () => {
    server.use(http.delete('/api/v1/tasks/t-1', () => HttpResponse.json({ ok: true })));
    const env = setup();
    const hook = renderHook(() => useDeleteTask('t-1'), { wrapper: env.wrapper });

    act(() => {
      hook.result.current.mutate();
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(env.client.getQueryData(tasksKeys.detail('t-1'))).toBeUndefined();
    expectStampedRound(env);
  });

  it('bulk-операция журнала: витрины задач — сразу и с меткой', async () => {
    server.use(
      http.post('/api/v1/tasks/bulk', () =>
        HttpResponse.json({ results: [{ taskId: 't-1', ok: true }] }),
      ),
    );
    const env = setup();
    const hook = renderHook(() => useBulkTasks(), { wrapper: env.wrapper });

    act(() => {
      hook.result.current.mutate({
        taskIds: ['t-1'],
        action: { kind: 'move_to_stage', stageId: 's-1' },
      });
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expectStampedRound(env);
  });

  it('каскад срока подзадач: витрины задач — сразу и с меткой', async () => {
    server.use(
      http.patch('/api/v1/tasks/:id', ({ params }) =>
        HttpResponse.json({ id: params.id, deadline: '2026-12-01' }),
      ),
    );
    const env = setup();
    const hook = renderHook(() => useShiftSubtaskDeadlines(), { wrapper: env.wrapper });

    act(() => {
      hook.result.current.mutate([
        { id: 't-1', deadline: '2026-12-01' },
        { id: 't-2', deadline: '2026-12-02' },
      ]);
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(toast.success).toHaveBeenCalledTimes(1);
    expectStampedRound(env);
  });
});
