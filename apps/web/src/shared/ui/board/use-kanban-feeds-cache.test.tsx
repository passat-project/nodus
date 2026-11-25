// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Paginated, TaskListItem, TaskStage } from '@nodus/contracts';

import { hasTaskOverlay, publishTaskItem, resetTaskOverlay } from '../../api/task-overlay.js';
import { globalAxis } from '../../lib/board/kanban-board.js';
import { kanbanColumnKey } from '../../lib/board/kanban-column-key.js';
import { useKanbanBoard } from './use-kanban-board.js';

/**
 * Доска из кэша — сразу (#1051). Возврат в раздел и вход после наведения
 * находили страницы колонок в кэше, но ждали перезапроса со скелетоном.
 * Теперь устаревшая страница показывается сразу, свежая заменяет её.
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

/** Фиды колонок: сервер отвечает, только когда тест отпустит (`release`). */
function gateFeeds() {
  const server: Record<string, TaskListItem[]> = { a: [], b: [] };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    await gate;
    const items = (String(input).includes('stage=a') ? server.a : server.b) ?? [];
    return jsonResponse({ items, nextCursor: null } satisfies Paginated<TaskListItem>);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { server, release: () => act(release), fetchMock };
}

/** Страница в кэше давностью `ageMs` (устаревшая — перезапросится при входе). */
function seedCache(client: QueryClient, items: Record<string, TaskListItem[]>, ageMs: number) {
  for (const [stageId, list] of Object.entries(items)) {
    client.setQueryData(
      kanbanColumnKey(['test-board'], stageId),
      { items: list, nextCursor: null },
      { updatedAt: Date.now() - ageMs },
    );
  }
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const titles = (items: TaskListItem[]) => items.map((t) => t.title);

function useTestBoard() {
  return useKanbanBoard({
    axis: globalAxis,
    stages: [A, B],
    queryKey: ['test-board'],
    feedUrl: (stageId) => `/feed?stage=${stageId}`,
    onMove: vi.fn(),
  });
}

describe('доска из кэша — сразу, свежая страница — догрузкой (#1051)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTaskOverlay();
  });

  it('устаревшие страницы показываются до ответа сервера; свежие заменяют их', async () => {
    const { server, release, fetchMock } = gateFeeds();
    server.a = [task('t1', A, 'свежее имя')];
    const client = newClient();
    seedCache(client, { a: [task('t1', A, 'прежнее имя')], b: [] }, 120_000);

    const { result } = renderHook(useTestBoard, { wrapper: makeWrapper(client) });

    // Сервер ещё молчит (перезапрос в полёте), а доска уже собрана из кэша.
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(titles(result.current.items)).toEqual(['прежнее имя']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    release();
    await waitFor(() => expect(titles(result.current.items)).toEqual(['свежее имя']));
  });

  it('страница из кэша не снимает ответ мутации: имя из ответа видно до свежей страницы', async () => {
    const { server, release } = gateFeeds();
    server.a = [task('t1', A, 'ответ сервера')];
    const client = newClient();
    seedCache(client, { a: [task('t1', A, 'прежнее имя')], b: [] }, 120_000);
    publishTaskItem(task('t1', A, 'ответ сервера'));

    const { result } = renderHook(useTestBoard, { wrapper: makeWrapper(client) });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(titles(result.current.items)).toEqual(['ответ сервера']);
    expect(hasTaskOverlay('t1')).toBe(true);

    release();
    await waitFor(() => expect(hasTaskOverlay('t1')).toBe(false));
    expect(titles(result.current.items)).toEqual(['ответ сервера']);
  });

  it('свежие страницы из кэша — без единого запроса', async () => {
    const { fetchMock } = gateFeeds();
    const client = newClient();
    seedCache(client, { a: [task('t1', A, 'из кэша')], b: [] }, 1_000);

    const { result } = renderHook(useTestBoard, { wrapper: makeWrapper(client) });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(titles(result.current.items)).toEqual(['из кэша']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
