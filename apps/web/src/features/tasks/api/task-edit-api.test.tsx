// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Paginated, TaskDetail, TaskListItem } from '@nodus/contracts';

import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { useUpdateTask } from './task-edit-api.js';

const TASK_ID = '30000000-0000-4000-8000-000000000007';

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

const row = { id: TASK_ID, title: 'Старое', priority: 'normal' } as TaskListItem;
const pagesOf = (item: TaskListItem): InfiniteData<Paginated<TaskListItem>> => ({
  pages: [{ items: [item], nextCursor: null }],
  pageParams: [null],
});
const titleIn = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryData<InfiniteData<Paginated<TaskListItem>>>(key)?.pages[0]?.items[0]?.title;

describe('useUpdateTask: канон оптимистичной правки полей (I4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancel → патч детали и ВСЕХ журналов до ответа; ошибка → откат всех', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mineKey = tasksKeys.listPages();
    const allKey = tasksKeys.listPages({ scope: 'all' });
    client.setQueryData<TaskDetail>(tasksKeys.detail(TASK_ID), {
      ...row,
      description: '',
    } as TaskDetail);
    client.setQueryData(mineKey, pagesOf(row));
    client.setQueryData(allKey, pagesOf(row));
    const cancel = vi.spyOn(client, 'cancelQueries');
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'PATCH' ? gate.promise : jsonResponse(200, {}),
      ),
    );

    const { result } = renderHook(() => useUpdateTask(TASK_ID), { wrapper: makeWrapper(client) });
    await act(async () => {
      result.current.mutate({ title: 'Новое' });
    });

    // Летящие рефечи журнала и детали отменены — они затёрли бы патч.
    expect(cancel).toHaveBeenCalledWith({ queryKey: tasksKeys.detail(TASK_ID) });
    expect(cancel).toHaveBeenCalledWith({ queryKey: mineKey });
    // До ответа сервера: деталь и оба журнала уже с новым значением.
    expect(client.getQueryData<TaskDetail>(tasksKeys.detail(TASK_ID))?.title).toBe('Новое');
    expect(titleIn(client, mineKey)).toBe('Новое');
    expect(titleIn(client, allKey)).toBe('Новое');

    await act(async () => {
      gate.resolve(jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'x' }));
    });
    await waitFor(() => {
      expect(client.getQueryData<TaskDetail>(tasksKeys.detail(TASK_ID))?.title).toBe('Старое');
    });
    expect(titleIn(client, mineKey)).toBe('Старое');
    expect(titleIn(client, allKey)).toBe('Старое');
  });
});
