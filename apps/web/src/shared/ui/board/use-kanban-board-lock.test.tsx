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

import { resetRecentInvalidations } from '../../api/task-invalidate.js';
import { publishTaskItem, resetTaskOverlay, taskOverlayItem } from '../../api/task-overlay.js';
import { globalAxis } from '../../lib/board/kanban-board.js';
import { useKanbanBoard } from './use-kanban-board.js';

/**
 * Замок доски и оверлей (#1051). Регрессия прода: страница колонки, пришедшая
 * между дропом и ответом сервера, возвращала карточку в прежнюю колонку —
 * «перенос откатывается и повторяется»; правка имени была видна на доске
 * только после перезапроса всех колонок.
 */

const A: TaskStage = { id: 'a', name: 'Новая', order: 0, systemState: 'backlog', color: 'neutral' };
const B: TaskStage = {
  id: 'b',
  name: 'В работе',
  order: 1,
  systemState: 'active',
  color: 'success',
};

const task = (id: string, stage: TaskStage, title = id): TaskListItem =>
  ({ id, number: 1, title, stage, personalStageId: null, parentId: null }) as TaskListItem;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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

/** Состояние сервера, которое отдают фиды колонок (меняется по ходу теста). */
const server = { a: [] as TaskListItem[], b: [] as TaskListItem[] };

function stubFeeds() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const items = String(input).includes('stage=a') ? server.a : server.b;
      return jsonResponse({ items, nextCursor: null });
    }),
  );
}

function renderBoard(onMove = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = renderHook(
    () =>
      useKanbanBoard({
        axis: globalAxis,
        stages: [A, B],
        queryKey: ['test-board'],
        feedUrl: (stageId) => `/feed?stage=${stageId}`,
        onMove,
      }),
    { wrapper: makeWrapper(client) },
  );
  return { rendered, client };
}

type Board = ReturnType<typeof renderBoard>;
type MoveOpts = { onError: () => void; onSettled: () => void };

/** Взять t1 и бросить на пустую колонку B; возвращает колбэки переноса. */
async function dragT1ToB(board: Board, onMove: ReturnType<typeof vi.fn>): Promise<MoveOpts> {
  const { result } = board.rendered;
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => {
    result.current.dndHandlers.onDragStart({ active: { id: 't1' } } as unknown as DragStartEvent);
  });
  const over = { id: 'b', rect: { top: 0, height: 100 } };
  act(() => {
    result.current.dndHandlers.onDragOver({
      active: { id: 't1', rect: { current: { translated: null } } },
      over,
    } as unknown as DragOverEvent);
  });
  act(() => {
    result.current.dndHandlers.onDragEnd({
      active: { id: 't1' },
      over,
    } as unknown as DragEndEvent);
  });
  return onMove.mock.calls[0]?.[1] as MoveOpts;
}

const refetchColumns = (client: QueryClient) =>
  act(async () => {
    await client.refetchQueries({ queryKey: ['test-board', 'column'] });
    // Разные миллисекунды у соседних страниц: версия страницы — dataUpdatedAt.
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

const titleOf = (board: Board, id: string) =>
  board.rendered.result.current.items.find((t) => t.id === id)?.title;
const columnOf = (board: Board, id: string) =>
  board.rendered.result.current.items.find((t) => t.id === id)?.stage.id;

describe('useKanbanBoard: замок переносов и оверлей (#1051)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTaskOverlay();
    resetRecentInvalidations();
    server.a = [];
    server.b = [];
  });

  it('страница колонки, пришедшая между дропом и ответом сервера, НЕ возвращает карточку назад', async () => {
    server.a = [task('t1', A)];
    stubFeeds();
    const onMove = vi.fn();
    const board = renderBoard(onMove);
    const opts = await dragT1ToB(board, onMove);
    expect(columnOf(board, 't1')).toBe('b');
    expect(opts).toEqual({ onError: expect.any(Function), onSettled: expect.any(Function) });

    // Пока перенос в полёте, фиды отдают СТАРОЕ состояние: задача ещё в колонке A.
    await refetchColumns(board.client);
    expect(columnOf(board, 't1')).toBe('b');

    // Ответ сервера: он уже знает перенос — доска перезапрашивает колонки и применяет их.
    server.a = [];
    server.b = [task('t1', B, 't1-server')];
    await act(async () => {
      opts.onSettled();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    await waitFor(() => expect(titleOf(board, 't1')).toBe('t1-server'));
    expect(columnOf(board, 't1')).toBe('b');
  });

  it('страница, пришедшая раньше ответа переноса, не применяется и после снятия замка', async () => {
    server.a = [task('t1', A)];
    stubFeeds();
    const onMove = vi.fn();
    const board = renderBoard(onMove);
    const opts = await dragT1ToB(board, onMove);

    // Старая страница (задача в A) пришла под замком; ответ переноса её перебил не сразу:
    // свежий перезапрос вернул ошибку сети — старая страница так и лежит в кэше.
    await refetchColumns(board.client);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 500 })),
    );
    await act(async () => {
      opts.onSettled();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(columnOf(board, 't1')).toBe('b');

    // Следующий успешный перезапрос применяется.
    server.a = [];
    server.b = [task('t1', B, 't1-after')];
    stubFeeds();
    await refetchColumns(board.client);
    await waitFor(() => expect(titleOf(board, 't1')).toBe('t1-after'));
  });

  it('ошибка переноса: борд возвращается к снапшоту, замок снимается и снова пускает свежие страницы', async () => {
    server.a = [task('t1', A)];
    stubFeeds();
    const onMove = vi.fn();
    const board = renderBoard(onMove);
    const opts = await dragT1ToB(board, onMove);

    await act(async () => {
      opts.onError();
      opts.onSettled();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(columnOf(board, 't1')).toBe('a');

    server.a = [task('t1', A, 't1-fresh')];
    await refetchColumns(board.client);
    await waitFor(() => expect(titleOf(board, 't1')).toBe('t1-fresh'));
  });

  it('оверлей: правка видна на доске сразу; свежая страница не снимает оптимистичную запись', async () => {
    server.a = [task('t1', A)];
    stubFeeds();
    const board = renderBoard();
    await waitFor(() => expect(board.rendered.result.current.ready).toBe(true));
    const before = board.rendered.result.current.items[0] as TaskListItem;

    act(() => {
      publishTaskItem({ ...before, title: 'Новое имя' }, true);
    });
    expect(titleOf(board, 't1')).toBe('Новое имя');

    // Перезапрос, летящий во время мутации, вернул старое значение.
    await refetchColumns(board.client);
    expect(titleOf(board, 't1')).toBe('Новое имя');

    // Ответ сервера → запись более не оптимистичная; свежая страницу её снимает.
    act(() => {
      publishTaskItem({ ...before, title: 'Новое имя' });
    });
    expect(taskOverlayItem('t1')).toBeDefined();
    server.a = [task('t1', A, 'Новое имя')];
    await refetchColumns(board.client);
    await waitFor(() => expect(taskOverlayItem('t1')).toBeUndefined());
    expect(titleOf(board, 't1')).toBe('Новое имя');
  });
});
