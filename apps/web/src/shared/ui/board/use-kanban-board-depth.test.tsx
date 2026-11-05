// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskListItem, TaskStage } from '@nodus/contracts';

import { globalAxis } from '../../lib/board/kanban-board.js';
import { kanbanColumnKey } from '../../lib/board/kanban-column-key.js';
import { useKanbanBoard } from './use-kanban-board.js';

/**
 * #330: инвалидация колонки канбана перезапрашивает её на ВСЮ загруженную
 * глубину (`limit = загружено, ≤ 100`), а не первой страницей. Иначе
 * догруженный sentinel-ом хвост выбрасывался: прокрутка прыгала, а
 * переименования/удаления карточек хвоста не доезжали до UI.
 */

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

function renderBoard(client: QueryClient) {
  return renderHook(
    () =>
      useKanbanBoard({
        axis: globalAxis,
        stages: [A, B],
        queryKey: ['test-board'],
        feedUrl: (stageId, cursor, limit) =>
          `/feed?stage=${stageId}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
        onMove: vi.fn(),
      }),
    { wrapper: makeWrapper(client) },
  );
}

const first = Array.from({ length: 30 }, (_, i) => task(`a${i}`, A));
const tail = Array.from({ length: 5 }, (_, i) => task(`a${30 + i}`, A));
const full = [...first, ...tail];

/** Первая загрузка — 30 + курсор; перезапрос с limit ≥ 35 — вся глубина. */
function stubDepthFeed(options: {
  urls: string[];
  atDepth: () => TaskListItem[];
  tailPage?: TaskListItem[];
  atDepthCursor?: string | null;
}) {
  let cursorCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      options.urls.push(url);
      if (url.includes('stage=a') && url.includes('cursor=')) {
        cursorCalls += 1;
        // Первая догрузка — хвост; последующие (после перезапроса глубины) —
        // вытесненная вставкой карточка.
        return jsonResponse(200, {
          items: cursorCalls === 1 ? tail : (options.tailPage ?? []),
          nextCursor: null,
        });
      }
      if (url.includes('stage=a')) {
        const limit = Number(new URL(url, 'http://x').searchParams.get('limit'));
        if (limit >= full.length) {
          return jsonResponse(200, {
            items: options.atDepth(),
            nextCursor: options.atDepthCursor ?? null,
          });
        }
        return jsonResponse(200, { items: first, nextCursor: 'c1' });
      }
      return jsonResponse(200, { items: [], nextCursor: null });
    }),
  );
}

async function boardWithTail(client: QueryClient) {
  const { result } = renderBoard(client);
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => result.current.loadMore('a'));
  await waitFor(() =>
    expect(result.current.items.filter((t) => t.stage.id === 'a')).toHaveLength(35),
  );
  return result;
}

describe('колонка канбана: перезапрос на загруженную глубину (#330)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('инвалидация запрашивает limit = загружено и не теряет хвост', async () => {
    const urls: string[] = [];
    stubDepthFeed({ urls, atDepth: () => full });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = await boardWithTail(client);

    urls.length = 0;
    await act(() => client.invalidateQueries({ queryKey: kanbanColumnKey(['test-board'], 'a') }));
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));

    expect(urls[0]).toContain('limit=35');
    expect(result.current.items.filter((t) => t.stage.id === 'a')).toHaveLength(35);
    // Перезапрос уже содержит весь хвост — повторной догрузки нет.
    expect(urls.filter((url) => url.includes('cursor='))).toEqual([]);
  });

  it('переименование карточки в догруженном хвосте доезжает до UI', async () => {
    const urls: string[] = [];
    const renamed = full.map((t) => (t.id === 'a30' ? { ...t, title: 'переименована' } : t));
    stubDepthFeed({ urls, atDepth: () => renamed });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = await boardWithTail(client);

    await act(() => client.invalidateQueries({ queryKey: kanbanColumnKey(['test-board'], 'a') }));
    await waitFor(() =>
      expect(result.current.items.find((t) => t.id === 'a30')?.title).toBe('переименована'),
    );
  });

  it('вставка карточки сверху не теряет вытесненную: её догружает курсор', async () => {
    const urls: string[] = [];
    const inserted = [task('new', A), ...first, ...tail];
    // Свежий ответ на глубину 35: новая + a0..a33, a34 вытеснена за страницу.
    stubDepthFeed({
      urls,
      atDepth: () => inserted.slice(0, 35),
      atDepthCursor: 'c1',
      tailPage: [task('a34', A)],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = await boardWithTail(client);

    await act(() => client.invalidateQueries({ queryKey: kanbanColumnKey(['test-board'], 'a') }));
    await waitFor(() => expect(result.current.cursors.a).toBe('c1'));
    expect(result.current.items.filter((t) => t.id === 'a34')).toHaveLength(0);

    // Курсор свежий: вытесненная карточка догружается, а не теряется.
    act(() => result.current.loadMore('a'));
    await waitFor(() => expect(result.current.items.filter((t) => t.id === 'a34')).toHaveLength(1));
  });
});
