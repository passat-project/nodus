// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Paginated, TaskListItem } from '@nodus/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskList } from './task-list.js';

/**
 * A6-4 (#632): строки дерева задач перерисовывались все на любое изменение
 * (выбор строки, ховер, подвод курсора к краю). Строка вынесена и
 * мемоизирована; счётчик рендеров — вызовы построителя меню строки
 * (`makeCardRowMenuItems` зовётся ровно один раз на рендер строки).
 */

const menuCalls = vi.hoisted(() => new Map<string, number>());

vi.mock('../../../shared/views/card-row-menu.js', () => ({
  makeCardRowMenuItems: (ref: { id: string }) => {
    menuCalls.set(ref.id, (menuCalls.get(ref.id) ?? 0) + 1);
    return [];
  },
}));

const TYPE = {
  id: '20000000-0000-4000-8000-000000000900',
  code: 'task',
  name: 'Задача',
  category: 'task',
  icon: 'square-check',
  color: 'info',
} as const;

const STAGE = {
  id: '20000000-0000-4000-8000-000000000001',
  name: 'Новые',
  order: 0,
  systemState: 'backlog',
  color: 'neutral',
  outcome: null,
} as const;

const USER = { id: 'u1', displayName: 'Тест Тест', avatarUrl: null };

function task(id: string, title: string): TaskListItem {
  return {
    id,
    number: 100,
    title,
    type: { ...TYPE },
    stage: { ...STAGE },
    personalStageId: null,
    customFields: {},
    priority: 'normal',
    deadline: null,
    creator: USER,
    assignee: null,
    participants: [],
    project: null,
    parentId: null,
    nodeId: null,
    spentMinutes: 0,
    plannedMinutes: null,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    updatedAt: '2026-09-01T00:00:00Z',
  } as TaskListItem;
}

const TASKS = [
  task('30000000-0000-4000-8000-00000000000a', 'Первая'),
  task('30000000-0000-4000-8000-00000000000b', 'Вторая'),
  task('30000000-0000-4000-8000-00000000000c', 'Третья'),
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<TaskList />, { wrapper });
}

beforeEach(() => {
  menuCalls.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Атрибутные колонки (#632): реестр пуст — строки только системные.
      if (url.includes('/custom-fields/definitions')) return jsonResponse([]);
      // Поиск сотрудников (островок массовых действий, пикеры) — пусто.
      if (url.includes('/directory/users')) return jsonResponse({ items: [], nextCursor: null });
      const page: Paginated<TaskListItem> = { items: TASKS, nextCursor: null };
      return jsonResponse(page);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TaskList: мемоизация строк (A6-4)', () => {
  it('выбор строки перерисовывает только её', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Вторая')).toBeTruthy());
    expect(menuCalls.size).toBe(3);
    const before = new Map(menuCalls);

    // Чекбоксы: [0] — «выбрать все» в шапке, далее по строкам.
    fireEvent.click(screen.getAllByRole('checkbox')[2]!);

    const second = TASKS[1]!.id;
    expect(menuCalls.get(second)).toBe((before.get(second) ?? 0) + 1);
    expect(menuCalls.get(TASKS[0]!.id)).toBe(before.get(TASKS[0]!.id));
    expect(menuCalls.get(TASKS[2]!.id)).toBe(before.get(TASKS[2]!.id));
    expect(screen.getAllByRole('checkbox')[2]!.getAttribute('aria-checked')).toBe('true');
  });
});
