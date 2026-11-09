// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { TaskListItem } from '@nodus/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import type { CellContext } from './task-fields.js';
import { taskListFields } from './task-fields.js';

/**
 * #670: тип задачи виден в журнале «Список» без открытия карточки — значок
 * типа перед названием. Это не колонка (реестр и настройки вида не меняются):
 * значок живёт в ячейке названия и появляется во всех списках задач.
 */

const USER = { id: 'u1', displayName: 'Тест Тест', avatarUrl: null };

const TYPE = {
  id: '20000000-0000-4000-8000-000000000901',
  code: 'overtime',
  name: 'Переработка',
  category: 'task',
  icon: 'calendar-clock',
  color: 'warning',
} as const;

const STAGE = {
  id: '20000000-0000-4000-8000-000000000001',
  name: 'Новые',
  order: 0,
  systemState: 'backlog',
  color: 'neutral',
  outcome: null,
} as const;

function taskOf(extra: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    number: 100,
    title: 'Согласовать АР',
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
    ...extra,
  } as TaskListItem;
}

function titleOf() {
  return taskListFields.find((field) => field.id === 'title')!;
}

function renderTitle(ctx: CellContext = {}) {
  return render(<span>{titleOf().render(taskOf(), ctx)}</span>);
}

afterEach(cleanup);

describe('taskListFields: значок типа в названии (#670)', () => {
  it('тип не отдельной колонкой — реестр прежний', () => {
    expect(taskListFields.some((field) => field.id === 'type')).toBe(false);
  });

  it('ячейка названия показывает значок типа с доступным именем', () => {
    renderTitle();
    expect(screen.getByRole('img', { name: 'Переработка' })).toBeTruthy();
    expect(screen.getByText('Согласовать АР')).toBeTruthy();
  });

  it('свёрнутая ветка сохраняет значок типа и счётчик скрытых потомков', () => {
    const { container } = renderTitle({ branchCollapsed: true, childCount: 2 });
    expect(screen.getByRole('img', { name: 'Переработка' })).toBeTruthy();
    expect(container.textContent).toContain('+2');
  });
});
