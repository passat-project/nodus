// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PressExecuteResult, TaskDetail } from '@nodus/contracts';

import { useExcludePress, useReturnPress, useSubmitPress, useWithdrawPress } from './press-api.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TASK_ID = '30000000-0000-4000-8000-000000000001';
const USER_ID = '10000000-0000-4000-8000-000000000001';

const press = {
  id: '70000000-0000-4000-8000-000000000001',
  stageId: '60000000-0000-4000-8000-000000000001',
  transitionId: '60000000-0000-4000-8000-000000000002',
  transitionName: 'Завершить',
  cycle: 1,
  total: 2,
  pressed: 0,
  order: 'parallel' as const,
  quorum: { kind: 'all' as const },
  entries: [
    {
      userId: USER_ID,
      displayName: 'Я',
      order: 0,
      state: 'waiting' as const,
      pressedAt: null,
      result: null,
      returnReason: null,
    },
  ],
  myEntry: {
    userId: USER_ID,
    displayName: 'Я',
    order: 0,
    state: 'waiting' as const,
    pressedAt: null,
    result: null,
    returnReason: null,
  },
  canSubmit: true,
  canWithdraw: false,
  canReturn: false,
  canExclude: false,
  completed: false,
};

const detail = { id: TASK_ID, press } as unknown as TaskDetail;
const result = { press, task: detail, transitions: [] } as unknown as PressExecuteResult;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client } satisfies QueryClientProviderProps,
      children,
    );
  };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(tasksKeys.detail(TASK_ID), detail);
  const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
    void args;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { client, fetchMock };
}

describe('press-api (#434)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submit: оптимистично ставит мою отметку и патчит карточку ответом', async () => {
    const { client, fetchMock } = setup();
    const { result: hook } = renderHook(() => useSubmitPress(TASK_ID), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      hook.current.mutate({ result: { text: 'Итог', messageIds: [] } });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/tasks/${TASK_ID}/press/submit`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('submit: ошибка откатывает оптимистичный кэш', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(tasksKeys.detail(TASK_ID), detail);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'CONFLICT', message: 'no' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const { result: hook } = renderHook(() => useSubmitPress(TASK_ID), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      hook.current.mutate({ result: { text: 'Итог', messageIds: [] } });
    });
    await waitFor(() => expect(hook.current.isError).toBe(true));
    const cached = client.getQueryData<TaskDetail>(tasksKeys.detail(TASK_ID));
    expect(cached?.press?.pressed).toBe(0);
  });

  it('withdraw, return и exclude используют свои маршруты', async () => {
    const { client, fetchMock } = setup();
    const withdraw = renderHook(() => useWithdrawPress(TASK_ID), {
      wrapper: makeWrapper(client),
    });
    const returnHook = renderHook(() => useReturnPress(TASK_ID), {
      wrapper: makeWrapper(client),
    });
    const excludeHook = renderHook(() => useExcludePress(TASK_ID), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      withdraw.result.current.mutate();
      returnHook.result.current.mutate({ userIds: [USER_ID], reason: 'Доработать' });
      excludeHook.result.current.mutate({ userIds: [USER_ID], reason: 'Уволен' });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.endsWith('/press/withdraw'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/press/return'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/press/exclude'))).toBe(true);
  });
});
