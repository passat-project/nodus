// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import type { TaskListItem, TaskStage } from '@nodus/contracts';
import { toast } from 'sonner';

import { globalAxis } from '../../lib/board/kanban-board.js';
import { kanbanColumnKey } from '../../lib/board/kanban-column-key.js';
import { useKanbanBoard } from './use-kanban-board.js';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const A: TaskStage = { id: 'a', name: 'Новая', order: 0, systemState: 'backlog', color: 'neutral' };
const B: TaskStage = {
  id: 'b',
  name: 'В работе',
  order: 1,
  systemState: 'active',
  color: 'success',
};

const task = (id: string, stage: TaskStage): TaskListItem =>
  ({ id, number: 1, title: id, stage, personalStageId: null, parentId: null }) as TaskListItem;

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

/** Фиды: колонка A — одна задача и следующая страница; B — пустая. */
function stubFeeds(nextPage: () => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cursor=')) return nextPage();
      if (url.includes('stage=a'))
        return jsonResponse(200, { items: [task('t1', A)], nextCursor: 'c1' });
      return jsonResponse(200, { items: [], nextCursor: null });
    }),
  );
}

function renderBoard(
  onMove = vi.fn(),
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return renderHook(
    () =>
      useKanbanBoard({
        axis: globalAxis,
        stages: [A, B],
        queryKey: ['test-board'],
        feedUrl: (stageId, cursor, limit) =>
          `/feed?stage=${stageId}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
        onMove,
      }),
    { wrapper: makeWrapper(client) },
  );
}

describe('useKanbanBoard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('drop на ПУСТУЮ колонку глобальной оси: без TypeError, перенос в колонку (регрессия)', async () => {
    stubFeeds(async () => jsonResponse(200, { items: [], nextCursor: null }));
    const onMove = vi.fn();
    const { result } = renderBoard(onMove);
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.dndHandlers.onDragStart({ active: { id: 't1' } } as unknown as DragStartEvent);
    });
    // over — id колонки B (пустая колонка: задач под указателем нет).
    const over = { id: 'b', rect: { top: 0, height: 100 } };
    act(() => {
      result.current.dndHandlers.onDragOver({
        active: { id: 't1', rect: { current: { translated: null } } },
        over,
      } as unknown as DragOverEvent);
    });
    expect(() =>
      act(() => {
        result.current.dndHandlers.onDragEnd({
          active: { id: 't1' },
          over,
        } as unknown as DragEndEvent);
      }),
    ).not.toThrow();
    expect(onMove).toHaveBeenCalledWith(
      { taskId: 't1', stageId: 'b', index: 0 },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  /** #737: живая перестановка «над/под» указателем + drop ровно там, где
   *  стоял фантом (слот). Колонка A — две карточки t1, t2 (t1 сверху). */
  it('loadMore стабилен между рендерами при инлайн-feedUrl (observer колонки не пересоздаётся)', async () => {
    stubFeeds(async () => jsonResponse(200, { items: [], nextCursor: null }));
    const { result, rerender } = renderBoard();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const first = result.current.loadMore;
    rerender();
    expect(result.current.loadMore).toBe(first);
  });

  it('loadMore: ошибка догрузки сбрасывает флаг, показывает тост и не повторяет запрос сама', async () => {
    let calls = 0;
    stubFeeds(async () => {
      calls += 1;
      return jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'x' });
    });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.loadMore('a'));
    expect(result.current.loadingMore.a).toBe(true);
    await waitFor(() => expect(result.current.loadingMore.a).toBe(false));
    expect(toast.error).toHaveBeenCalledTimes(1);

    // Sentinel пересоздаёт observer при смене loadingMore и сразу зовёт
    // loadMore снова — сбойная колонка не уходит в шквал запросов.
    act(() => result.current.loadMore('a'));
    expect(result.current.loadingMore.a).toBe(false);
    expect(calls).toBe(1);
  });

  it('инвалидация ОДНОЙ колонки (#322): запрос только её фида, догрузки соседней живут', async () => {
    const urls: string[] = [];
    let bFeed: TaskListItem[] = [task('b1', B)];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('stage=a') && url.includes('cursor='))
          return jsonResponse(200, { items: [task('t2', A)], nextCursor: null });
        if (url.includes('stage=a'))
          return jsonResponse(200, { items: [task('t1', A)], nextCursor: 'c1' });
        return jsonResponse(200, { items: bFeed, nextCursor: null });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderBoard(vi.fn(), client);
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.loadMore('a'));
    await waitFor(() => expect(result.current.items.map((t) => t.id)).toContain('t2'));

    urls.length = 0;
    // Коллега перенёс t1 из A в B: WS-событие инвалидирует только колонку B —
    // карточка не дублируется (уходит из A), догруженная t2 в A остаётся.
    bFeed = [task('t1', B), task('b1', B)];
    await act(() => client.invalidateQueries({ queryKey: kanbanColumnKey(['test-board'], 'b') }));
    await waitFor(() =>
      expect(result.current.items.filter((t) => t.stage.id === 'b').map((t) => t.id)).toEqual([
        't1',
        'b1',
      ]),
    );
    expect(urls).toEqual(['/api/v1/feed?stage=b&limit=30']);
    expect(result.current.items.filter((t) => t.stage.id === 'a').map((t) => t.id)).toEqual(['t2']);
    expect(result.current.items.filter((t) => t.id === 't1')).toHaveLength(1);
  });
});
