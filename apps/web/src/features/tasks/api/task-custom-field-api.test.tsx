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
import { useUpdateTaskCustomField } from './task-custom-field-api.js';

const TASK_ID = '30000000-0000-4000-8000-000000000007';
const FIELD_ID = '50000000-0000-4000-8000-000000000001';
const USER_ID = '10000000-0000-4000-8000-000000000001';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const row = { id: TASK_ID, title: 'Задача', customFields: {} } as TaskListItem;
const pagesOf = (item: TaskListItem): InfiniteData<Paginated<TaskListItem>> => ({
  pages: [{ items: [item], nextCursor: null }],
  pageParams: [null],
});
const valuesIn = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryData<InfiniteData<Paginated<TaskListItem>>>(key)?.pages[0]?.items[0]?.customFields;

describe('useUpdateTaskCustomField: оптимистичная правка поля (#431, I4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('значение и ссылка в кэше до ответа; null удаляет ключ; ошибка — откат', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mineKey = tasksKeys.listPages();
    const allKey = tasksKeys.listPages({ scope: 'all' });
    client.setQueryData<TaskDetail>(tasksKeys.detail(TASK_ID), {
      ...row,
      description: '',
      customFieldRefs: [],
    } as unknown as TaskDetail);
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

    const { result } = renderHook(() => useUpdateTaskCustomField(TASK_ID), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      result.current.mutate({
        fieldId: FIELD_ID,
        value: USER_ID,
        refs: [
          { kind: 'user', id: USER_ID, name: 'Иван Петров', avatarUrl: null, archived: false },
        ],
      });
    });

    expect(cancel).toHaveBeenCalledWith({ queryKey: tasksKeys.detail(TASK_ID) });
    expect(cancel).toHaveBeenCalledWith({ queryKey: mineKey });
    const detail = client.getQueryData<TaskDetail>(tasksKeys.detail(TASK_ID));
    expect(detail?.customFields[FIELD_ID]).toBe(USER_ID);
    expect(detail?.customFieldRefs[0]?.name).toBe('Иван Петров');
    expect(valuesIn(client, mineKey)?.[FIELD_ID]).toBe(USER_ID);
    expect(valuesIn(client, allKey)?.[FIELD_ID]).toBe(USER_ID);

    await act(async () => {
      gate.resolve(jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'x' }));
    });
    await waitFor(() => {
      expect(
        client.getQueryData<TaskDetail>(tasksKeys.detail(TASK_ID))?.customFields[FIELD_ID],
      ).toBeUndefined();
    });
    expect(valuesIn(client, mineKey)?.[FIELD_ID]).toBeUndefined();
    expect(valuesIn(client, allKey)?.[FIELD_ID]).toBeUndefined();
  });

  it('null очищает значение в детали и журналах', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mineKey = tasksKeys.listPages();
    const filled = { ...row, customFields: { [FIELD_ID]: '№ 12' } } as TaskListItem;
    client.setQueryData<TaskDetail>(tasksKeys.detail(TASK_ID), {
      ...filled,
      description: '',
      customFieldRefs: [],
    } as unknown as TaskDetail);
    client.setQueryData(mineKey, pagesOf(filled));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { ...filled, customFields: {} })),
    );

    const { result } = renderHook(() => useUpdateTaskCustomField(TASK_ID), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      result.current.mutate({ fieldId: FIELD_ID, value: null });
    });
    expect(
      client.getQueryData<TaskDetail>(tasksKeys.detail(TASK_ID))?.customFields[FIELD_ID],
    ).toBeUndefined();
    expect(valuesIn(client, mineKey)?.[FIELD_ID]).toBeUndefined();
  });
});
