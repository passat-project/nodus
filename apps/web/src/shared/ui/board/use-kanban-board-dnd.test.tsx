// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import type { TaskListItem, TaskStage } from '@nodus/contracts';

import { globalAxis } from '../../lib/board/kanban-board.js';
import { useKanbanBoard } from './use-kanban-board.js';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/**
 * #737: интерактивный перенос карточки канбана — сторона вставки следует за
 * указателем на КАЖДОМ движении (и между колонками, и внутри), drop совпадает
 * с показанным фантомом (пунктирным слотом), откат при ошибке сервера — к
 * снапшоту dragStart. Чистый расчёт индекса — kanban-drop-index.test.ts.
 */

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

function stubTwoCardColumn() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('stage=a'))
        return jsonResponse(200, { items: [task('t1', A), task('t2', A)], nextCursor: null });
      return jsonResponse(200, { items: [], nextCursor: null });
    }),
  );
}

/**
 * @returns доска, отрендеренная как хук; feedUrl — общий для тестов файла.
 */
function renderDndBoard(onMove = vi.fn(), onMoveRolledBack?: (from: string, to: string) => void) {
  return renderHook(
    () =>
      useKanbanBoard({
        axis: globalAxis,
        stages: [A, B],
        queryKey: ['test-board-dnd'],
        feedUrl: (stageId, cursor, limit) =>
          `/feed?stage=${stageId}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
        onMove,
        onMoveRolledBack,
      }),
    { wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })) },
  );
}

describe('useKanbanBoard: живой DnD по указателю (#737)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('#737: сторона вставки следует за указателем на каждом движении, drop = фантом', async () => {
    stubTwoCardColumn();
    const onMove = vi.fn();
    const { result } = renderDndBoard(onMove);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.items.map((t) => t.id)).toEqual(['t1', 't2']);

    act(() => {
      result.current.dndHandlers.onDragStart({ active: { id: 't1' } } as unknown as DragStartEvent);
    });
    // Цель — t2 (верх 100, высота 100, середина 150); указатель начал на 100
    // и его вели вниз: дельта 80 → 180 — НИЖЕ середины → карточка падает за t2.
    const over = { id: 't2', rect: { top: 100, height: 100 } };
    act(() => {
      result.current.dndHandlers.onDragMove({
        active: { id: 't1', rect: { current: { translated: null } } },
        over,
        activatorEvent: { clientY: 100 },
        delta: { x: 0, y: 80 },
      } as unknown as DragMoveEvent);
    });
    // Борд переставлен ещё до drop: t1 стала под t2 — это и есть фантом.
    expect(result.current.items.map((t) => t.id)).toEqual(['t2', 't1']);

    act(() => {
      result.current.dndHandlers.onDragEnd({
        active: { id: 't1' },
        over,
      } as unknown as DragEndEvent);
    });
    expect(onMove).toHaveBeenCalledWith(
      { taskId: 't1', stageId: 'a', index: 1 },
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    // Обратное движение тем же перетаскиванием: указатель снова ВЫШЕ середины
    // цели → борд возвращает t1 наверх, фантом не «залипает».
    act(() => {
      result.current.dndHandlers.onDragStart({ active: { id: 't1' } } as unknown as DragStartEvent);
    });
    act(() => {
      result.current.dndHandlers.onDragMove({
        active: { id: 't1', rect: { current: { translated: null } } },
        over,
        activatorEvent: { clientY: 100 },
        delta: { x: 0, y: 0 },
      } as unknown as DragMoveEvent);
    });
    expect(result.current.items.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('#737: колонка из ОДНОЙ карточки — «над» и «под» выбираются указателем', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('stage=a'))
          return jsonResponse(200, { items: [task('t1', A)], nextCursor: null });
        if (url.includes('stage=b'))
          return jsonResponse(200, { items: [task('b1', B)], nextCursor: null });
        return jsonResponse(200, { items: [], nextCursor: null });
      }),
    );
    const onMove = vi.fn();
    const { result } = renderDndBoard(onMove);
    await waitFor(() => expect(result.current.ready).toBe(true));

    const over = { id: 'b1', rect: { top: 100, height: 100 } };
    const dragTo = (clientY: number) => {
      act(() => {
        result.current.dndHandlers.onDragMove({
          active: { id: 't1', rect: { current: { translated: null } } },
          over,
          activatorEvent: { clientY },
          delta: { x: 0, y: 0 },
        } as unknown as DragMoveEvent);
      });
    };

    /** Кадр анти-осциллятора: после межколоночного переноса движок пропускает
     *  один кадр (rect устарели) — в жизни это 16 мс, в тесте ждём явно. */
    const nextFrame = () =>
      act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });

    act(() => {
      result.current.dndHandlers.onDragStart({ active: { id: 't1' } } as unknown as DragStartEvent);
    });
    // Выше середины цели → карточка встаёт НАД b1.
    dragTo(120);
    expect(result.current.items.filter((t) => t.stage.id === 'b').map((t) => t.id)).toEqual([
      't1',
      'b1',
    ]);
    await nextFrame();
    // Ниже середины → ПОД b1 (переключение живьём, без нового входа в колонку).
    dragTo(180);
    expect(result.current.items.filter((t) => t.stage.id === 'b').map((t) => t.id)).toEqual([
      'b1',
      't1',
    ]);

    act(() => {
      result.current.dndHandlers.onDragEnd({
        active: { id: 't1' },
        over,
      } as unknown as DragEndEvent);
    });
    expect(onMove).toHaveBeenCalledWith(
      { taskId: 't1', stageId: 'b', index: 1 },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('#737: откат при ошибке сервера — доска возвращается к снапшоту dragStart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('stage=a'))
          return jsonResponse(200, { items: [task('t1', A), task('t2', A)], nextCursor: null });
        return jsonResponse(200, { items: [], nextCursor: null });
      }),
    );
    const onMove = vi.fn();
    const onRolledBack = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () =>
        useKanbanBoard({
          axis: globalAxis,
          stages: [A, B],
          queryKey: ['test-board'],
          feedUrl: (stageId, cursor, limit) =>
            `/feed?stage=${stageId}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
          onMove,
          onMoveRolledBack: onRolledBack,
        }),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));

    const over = { id: 't2', rect: { top: 100, height: 100 } };
    act(() => {
      result.current.dndHandlers.onDragStart({ active: { id: 't1' } } as unknown as DragStartEvent);
    });
    act(() => {
      result.current.dndHandlers.onDragMove({
        active: { id: 't1', rect: { current: { translated: null } } },
        over,
        activatorEvent: { clientY: 100 },
        delta: { x: 0, y: 80 },
      } as unknown as DragMoveEvent);
    });
    act(() => {
      result.current.dndHandlers.onDragEnd({
        active: { id: 't1' },
        over,
      } as unknown as DragEndEvent);
    });
    expect(result.current.items.map((t) => t.id)).toEqual(['t2', 't1']);

    // Сервер отказал — I4: откат к снапшоту dragStart и минус счётчику.
    const [, opts] = onMove.mock.calls[0] as [unknown, { onError: () => void }];
    act(() => opts.onError());

    expect(onRolledBack).toHaveBeenCalledWith('a', 'a');
    expect(result.current.items.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});
