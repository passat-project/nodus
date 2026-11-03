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

import { tasksKeys, useUpdateTaskStage } from './tasks-api.js';

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
    const client = new QueryClient();
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
