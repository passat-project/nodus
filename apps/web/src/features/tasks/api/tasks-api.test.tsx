// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Paginated, TaskListItem } from '@nodus/contracts';

import { tasksKeys, usePrefetchTask, useUpdateTaskStage } from './tasks-api.js';

const systemProcessType = {
  id: '20000000-0000-4000-8000-000000000900',
  code: 'task',
  name: 'Задача',
  category: 'task',
  icon: 'square-check',
  color: 'info',
} as const;

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

/** Контролируемый deferred: ответ сервера отпускаем вручную (детерминизм, без миллисекунд). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const STAGE_A = {
  id: '20000000-0000-4000-8000-000000000001',
  name: 'Новые',
  order: 0,
  systemState: 'backlog',
  color: 'neutral',
} as const;
const STAGE_B = {
  id: '20000000-0000-4000-8000-000000000003',
  name: 'В работе',
  order: 2,
  systemState: 'active',
  color: 'success',
} as const;

function taskInStage(stage: typeof STAGE_A | typeof STAGE_B): TaskListItem {
  return {
    id: TASK_ID,
    number: 101,
    title: 'Переносимая',
    type: systemProcessType,
    stage: { ...stage },
    personalStageId: null,
    customFields: {},
    priority: 'normal',
    deadline: null,
    creator: { id: 'u1', displayName: 'Тест Тест', avatarUrl: null },
    assignee: null,
    participants: [],
    project: null,
    parentId: null,
    nodeId: null,
    spentMinutes: 0,
    plannedMinutes: null,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

describe('useUpdateTaskStage: оптимистичность переноса (I4)', () => {
  it('стадия в кэше меняется ДО ответа сервера; ошибка → откат', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(tasksKeys.stages(), [STAGE_A, STAGE_B]);
    client.setQueryData(tasksKeys.listPages(), {
      pages: [{ items: [taskInStage(STAGE_A)], nextCursor: null }],
      pageParams: [null],
    });
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'PATCH' ? gate.promise : jsonResponse(200, []),
      ),
    );

    const { result } = renderHook(() => useUpdateTaskStage(), { wrapper: makeWrapper(client) });
    await act(async () => {
      result.current.mutate({ taskId: TASK_ID, stageId: STAGE_B.id, index: 0 });
    });

    const optimistic = client.getQueryData<InfiniteData<Paginated<TaskListItem>>>(
      tasksKeys.listPages(),
    );
    expect(optimistic?.pages[0]?.items[0]?.stage.id).toBe(STAGE_B.id);

    await act(async () => {
      gate.resolve(jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'x' }));
    });
    await waitFor(() => {
      const rolled = client.getQueryData<InfiniteData<Paginated<TaskListItem>>>(
        tasksKeys.listPages(),
      );
      expect(rolled?.pages[0]?.items[0]?.stage.id).toBe(STAGE_A.id);
    });
  });
});

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
