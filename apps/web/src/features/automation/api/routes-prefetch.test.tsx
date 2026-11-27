// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProcessType } from '@nodus/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Ответы сервера по пути; отказ — значение-ошибка (`rejected`). */
const apiState = vi.hoisted(() => ({
  paths: [] as string[],
  rejected: new Set<string>(),
}));
vi.mock('../../../shared/api-client.js', () => ({
  api: vi.fn((path: string) => {
    apiState.paths.push(path);
    if (apiState.rejected.has(path)) return Promise.reject(new Error(`нет ${path}`));
    return Promise.resolve({ id: path.split('/').at(-1) });
  }),
}));

import { ROUTE_PREFETCH_LIMIT, usePrefetchRoutes } from './routes-prefetch.js';
import { workflowDetailOptions, workflowKeys } from '../../../shared/workflow/workflow-api.js';

const type = (id: string, workflowId: string) => ({ id, workflowId }) as ProcessType;
const route = (workflowId: string) => `/workflows/${workflowId}`;

/** Размонтировать всё и дать уже запущенным таймерам отработать — запросы
 *  одного теста не подтекают в следующий. */
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
  apiState.paths.length = 0;
  apiState.rejected.clear();
  vi.unstubAllGlobals();
});

function setup(types: ProcessType[]) {
  const queryClient = new QueryClient();
  queryClient.mount();
  const view = renderHook(({ list }: { list: ProcessType[] }) => usePrefetchRoutes(list), {
    initialProps: { list: types },
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...view, queryClient };
}

describe('предзагрузка маршрутов «Процессов» (#857, К4)', () => {
  it('кладёт маршрут каждого типа в кэш — под ключ запроса редактора', async () => {
    const { queryClient, unmount } = setup([type('t1', 'wf-1'), type('t2', 'wf-2')]);
    await waitFor(() => expect(apiState.paths).toEqual([route('wf-1'), route('wf-2')]));
    expect(queryClient.getQueryData(workflowKeys.detail('wf-1'))).toEqual({ id: 'wf-1' });
    expect(queryClient.getQueryData(workflowKeys.detail('wf-2'))).toEqual({ id: 'wf-2' });
    // Срок свежести — как у запроса редактора: выбор типа после предзагрузки
    // не ходит на сервер повторно.
    expect(queryClient.getQueryState(workflowKeys.detail('wf-1'))?.dataUpdatedAt).toBeGreaterThan(
      0,
    );
    unmount();
  });

  it('не сразу: в свободное время — запросы открытой рамы уходят раньше', () => {
    setup([type('t1', 'wf-1')]);
    expect(apiState.paths).toEqual([]);
  });

  it('использует requestIdleCallback, когда он есть, и снимает задачу при размонтировании', () => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const idle = vi.fn((callback: () => void) => {
      timers.set(timers.size + 1, setTimeout(callback, 0));
      return timers.size;
    });
    const cancel = vi.fn((id: number) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
    });
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', cancel);
    const { unmount } = setup([type('t1', 'wf-1')]);
    expect(idle).toHaveBeenCalledTimes(1);
    unmount();
    expect(cancel).toHaveBeenCalledWith(1);
    expect(apiState.paths).toEqual([]);
  });

  it('свежие маршруты не перезапрашиваются: новый массив с теми же типами — без запросов', async () => {
    const { queryClient, rerender } = setup([type('t1', 'wf-1')]);
    await waitFor(() =>
      expect(queryClient.getQueryState(workflowKeys.detail('wf-1'))?.status).toBe('success'),
    );
    act(() => rerender({ list: [type('t1', 'wf-1')] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiState.paths).toEqual([route('wf-1')]);
  });

  it('новый тип в списке — грузится только он', async () => {
    const { queryClient, rerender } = setup([type('t1', 'wf-1')]);
    await waitFor(() =>
      expect(queryClient.getQueryState(workflowKeys.detail('wf-1'))?.status).toBe('success'),
    );
    act(() => rerender({ list: [type('t1', 'wf-1'), type('t2', 'wf-2')] }));
    await waitFor(() => expect(apiState.paths).toEqual([route('wf-1'), route('wf-2')]));
  });

  it(`сверх потолка (${ROUTE_PREFETCH_LIMIT}) — только первые по списку`, async () => {
    const many = Array.from({ length: ROUTE_PREFETCH_LIMIT + 5 }, (_, i) =>
      type(`t${i}`, `wf-${i}`),
    );
    const { unmount } = setup(many);
    await waitFor(() => expect(apiState.paths).toHaveLength(ROUTE_PREFETCH_LIMIT));
    expect(apiState.paths.at(-1)).toBe(route(`wf-${ROUTE_PREFETCH_LIMIT - 1}`));
    unmount();
  });

  it('отказ одного маршрута не мешает остальным и не бросает наружу', async () => {
    apiState.rejected.add(route('wf-2'));
    const { queryClient, unmount } = setup([
      type('t1', 'wf-1'),
      type('t2', 'wf-2'),
      type('t3', 'wf-3'),
    ]);
    await waitFor(() =>
      expect(queryClient.getQueryState(workflowKeys.detail('wf-3'))?.status).toBe('success'),
    );
    expect(queryClient.getQueryData(workflowKeys.detail('wf-1'))).toEqual({ id: 'wf-1' });
    expect(queryClient.getQueryState(workflowKeys.detail('wf-2'))?.status).toBe('error');
    unmount();
  });

  it('тот же объект опций, что у запроса редактора: ключ и загрузка совпадают', () => {
    const options = workflowDetailOptions('wf-1');
    expect(options.queryKey).toEqual(workflowKeys.detail('wf-1'));
    expect(options.staleTime).toBe(30_000);
  });
});
