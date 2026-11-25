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

import { projectsKeys } from '../../../../shared/api/projects-list.js';
import {
  resetRecentInvalidations,
  wasInvalidatedRecently,
} from '../../../../shared/api/task-invalidate.js';
import { tasksKeys } from '../../../../shared/api/tasks-keys.js';
import { structureKeys } from './structure-api.js';
import { useMoveTaskNode, useSetTasksNode } from './structure-task-mutations.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * Перенос задач в узел структуры (#467, один раунд — #1051): журнал —
 * оптимистично, после ответа витрины задач перезапрашиваются сразу и с меткой
 * (эхо собственной мутации волну не повторяет), дерево узлов и карточка
 * проекта — с сервера (агрегаты).
 */

const server = setupServer();
const PROJECT = 'p-1';
const PAGES = tasksKeys.listPages();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
  resetRecentInvalidations();
});
afterAll(() => server.close());

function setup(items: TaskListItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<InfiniteData<Paginated<TaskListItem>>>(PAGES, {
    pages: [{ items, nextCursor: null }],
    pageParams: [null],
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const nodeOf = (id: string) =>
    client
      .getQueryData<InfiniteData<Paginated<TaskListItem>>>(PAGES)
      ?.pages[0]!.items.find((t) => t.id === id)?.nodeId;
  return { client, invalidate, wrapper, nodeOf };
}

/** Один раунд: широкий вызов один и с меткой; дерево и карточка проекта — перечитаны. */
const expectRound = (env: ReturnType<typeof setup>) => {
  const wide = env.invalidate.mock.calls.filter(
    ([filters]) => filters?.queryKey !== undefined && filters.queryKey.length === 1,
  );
  expect(wide).toHaveLength(1);
  expect(wasInvalidatedRecently(PAGES)).toBe(true);
  const keys = env.invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
  expect(keys).toContain(JSON.stringify(structureKeys.of(PROJECT)));
  expect(keys).toContain(JSON.stringify(projectsKeys.detail(PROJECT)));
};

const row = (id: string, nodeId: string): TaskListItem => ({ id, nodeId }) as TaskListItem;

describe('перенос задач в узел структуры: один раунд (#1051)', () => {
  it('одиночный: узел в журнале — до ответа; после — витрины задач с меткой, дерево и карточка проекта', async () => {
    let release!: () => void;
    server.use(
      http.patch('/api/v1/tasks/t-1', async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(row('t-1', 'n-2'));
      }),
    );
    const env = setup([row('t-1', 'n-1')]);
    const hook = renderHook(() => useMoveTaskNode(PROJECT), { wrapper: env.wrapper });

    act(() => {
      hook.result.current.mutate({ taskId: 't-1', nodeId: 'n-2' });
    });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(env.nodeOf('t-1')).toBe('n-2');

    await act(async () => {
      release();
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expectRound(env);
  });

  it('одиночный, отказ сервера: журнал возвращается к прежнему узлу', async () => {
    server.use(
      http.patch('/api/v1/tasks/t-1', () =>
        HttpResponse.json({ code: 'TASK_TRANSITION_DENIED', message: 'no' }, { status: 403 }),
      ),
    );
    const env = setup([row('t-1', 'n-1')]);
    const hook = renderHook(() => useMoveTaskNode(PROJECT), { wrapper: env.wrapper });

    act(() => {
      hook.result.current.mutate({ taskId: 't-1', nodeId: 'n-2' });
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));

    expect(env.nodeOf('t-1')).toBe('n-1');
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('мультиселект (bulk set_node): выбранные — в новый узел, после — тот же один раунд', async () => {
    server.use(
      http.post('/api/v1/tasks/bulk', () =>
        HttpResponse.json({ results: [{ taskId: 't-1', ok: true }] }),
      ),
    );
    const env = setup([row('t-1', 'n-1'), row('t-2', 'n-1')]);
    const hook = renderHook(() => useSetTasksNode(PROJECT), { wrapper: env.wrapper });

    act(() => {
      hook.result.current.mutate({ taskIds: ['t-1'], nodeId: null });
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(env.nodeOf('t-1')).toBeNull();
    expect(env.nodeOf('t-2')).toBe('n-1');
    expectRound(env);
  });
});
