// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../../../shared/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/api-client.js')>();
  return { ...actual, api: mocks.api };
});
vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { ApiError } from '../../../shared/api-client.js';
import { usePressAction, useWorkflowActions } from './transitions-api.js';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('действия маршрута в API задач (#633)', () => {
  it('useWorkflowActions читает GET /tasks/:id/actions', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.api.mockResolvedValueOnce([{ id: 'a1', name: 'Запросить уточнение' }]);

    const { result } = renderHook(() => useWorkflowActions('t1'), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.api).toHaveBeenCalledWith('/tasks/t1/actions');
    expect(result.current.data).toEqual([{ id: 'a1', name: 'Запросить уточнение' }]);
  });

  it('usePressAction: POST с ключом идемпотентности, тост и обновление кэшей', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const setData = vi.spyOn(client, 'setQueryData');
    mocks.api.mockResolvedValueOnce({ task: { id: 't1' }, transitions: [] });

    const { result } = renderHook(() => usePressAction('t1'), {
      wrapper: wrapper(client),
    });
    const action = {
      id: 'a1',
      name: 'Запросить уточнение',
      display: 'button' as const,
      form: null,
      blockedBy: [],
    };
    result.current.mutate({ action, body: { form: { comment: 'уточнение' } } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.api).toHaveBeenCalledWith(
      '/tasks/t1/actions/a1/press',
      expect.objectContaining({
        method: 'POST',
        body: { form: { comment: 'уточнение' } },
        idempotencyKey: expect.any(String),
      }),
    );
    expect(setData).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it('ошибка нажатия — тост с причиной, окно остаётся', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    mocks.api.mockRejectedValueOnce(new ApiError('WORKFLOW_TRANSITION_BLOCKED', 'blocked', 409));

    const { result } = renderHook(() => usePressAction('t1'), {
      wrapper: wrapper(client),
    });
    result.current.mutate({
      action: { id: 'a1', name: 'Действие', display: 'button', form: null, blockedBy: [] },
      body: {},
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.toastError).toHaveBeenCalled();
  });
});
