// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TaskDetail } from '@nodus/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openCard: vi.fn(),
  useTaskDetail: vi.fn(),
}));

vi.mock('../../../app/shell/use-card-stack.js', () => ({
  useOpenCard: () => mocks.openCard,
}));
vi.mock('../api/tasks-api.js', () => ({
  useTaskDetail: (id: string) => mocks.useTaskDetail(id),
}));

import { TaskLinkPreview } from './task-link-preview.js';

/** Превью ссылки на задачу в чате (#645): состав карточки, клик, недоступность. */

const TASK = '11111111-1111-4111-8111-111111111111';

function taskFixture(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: TASK,
    number: 125,
    title: 'Подготовить раздел АР стадии П',
    type: { id: 'type-1', name: 'Поручение', icon: 'square-check', color: 'info' },
    stage: {
      id: 'stage-1',
      name: 'В работе',
      order: 1,
      systemState: 'active',
      color: 'success',
    },
    priority: 'normal',
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    assignee: {
      id: 'user-1',
      displayName: 'Климович Александр Петрович',
      avatarUrl: null,
    },
    ...overrides,
  } as TaskDetail;
}

function mockTask(state: { data?: TaskDetail; isLoading?: boolean; isError?: boolean }): void {
  mocks.useTaskDetail.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
  });
}

beforeEach(() => {
  mocks.openCard.mockReset();
  mocks.useTaskDetail.mockReset();
});

afterEach(cleanup);

describe('TaskLinkPreview', () => {
  it('показывает тип, название, номер, стадию, ответственного и срок', () => {
    mockTask({ data: taskFixture() });
    render(<TaskLinkPreview id={TASK} />);

    expect(screen.getByText('Подготовить раздел АР стадии П')).toBeTruthy();
    expect(screen.getByText('№ 125')).toBeTruthy();
    expect(screen.getByText('Поручение')).toBeTruthy();
    expect(screen.getByText('В работе')).toBeTruthy();
    expect(screen.getByText('Александр Климович')).toBeTruthy();
    expect(mocks.useTaskDetail).toHaveBeenCalledWith(TASK);
  });

  it('клик открывает карточку задачи в приложении', () => {
    mockTask({ data: taskFixture() });
    render(<TaskLinkPreview id={TASK} />);

    fireEvent.click(screen.getByText('Подготовить раздел АР стадии П'));
    expect(mocks.openCard).toHaveBeenCalledWith({ kind: 'task', id: TASK });
  });

  it('высокий приоритет — чип приоритета', () => {
    mockTask({ data: taskFixture({ priority: 'high' }) });
    render(<TaskLinkPreview id={TASK} />);

    expect(screen.getByText('Высокий')).toBeTruthy();
  });

  it('просроченный срок — красный маркер «Просрочена»', () => {
    mockTask({
      data: taskFixture({ deadline: new Date(Date.now() - 86_400_000).toISOString() }),
    });
    render(<TaskLinkPreview id={TASK} />);

    expect(screen.getByText('Просрочена')).toBeTruthy();
  });

  it('нет доступа или задача удалена — плашка без названия', () => {
    mockTask({ isError: true });
    render(<TaskLinkPreview id={TASK} />);

    expect(screen.getByText('Задача недоступна')).toBeTruthy();
  });

  it('загрузка — скелетон без текста задачи', () => {
    mockTask({ isLoading: true });
    const { container } = render(<TaskLinkPreview id={TASK} />);

    expect(container.textContent).toBe('');
  });
});
