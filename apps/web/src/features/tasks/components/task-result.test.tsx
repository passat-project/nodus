// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail } from '@nodus/contracts';

vi.mock('../api/task-edit-api.js', () => ({
  useSaveTaskResult: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useTaskConversation: () => ({ data: { id: 'c1' } }),
}));
vi.mock('../../../shared/tasks/task-result-view.js', () => ({
  TaskResultView: () => <div>результат-вид</div>,
}));

import { TaskResultSection } from './task-result.js';

afterEach(cleanup);

const entry = (overrides: Record<string, unknown>) => ({
  userId: 'u1',
  displayName: 'Анна Ночная',
  avatarUrl: null,
  order: 0,
  state: 'pressed',
  pressedAt: '2026-11-20T12:25:00.000Z',
  result: { text: 'Текст', messageIds: [], fileCount: 0, minutes: null, date: null },
  returnReason: null,
  ...overrides,
});

const task = (overrides: Partial<TaskDetail> = {}): TaskDetail =>
  ({
    id: 't1',
    access: { canCheck: true },
    result: null,
    press: null,
    ...overrides,
  }) as unknown as TaskDetail;

describe('Результат задачи из отметок сбора (#965)', () => {
  it('показывает вклад каждого участника с автором и причиной выбытия', () => {
    render(
      <TaskResultSection
        task={task({
          press: {
            completed: true,
            entries: [
              entry({
                userId: 'u1',
                displayName: 'Анна Ночная',
                state: 'excluded',
                returnReason: 'Выбыл из задачи',
                result: {
                  text: 'Согласовал раздел ОВ1',
                  messageIds: [],
                  fileCount: 0,
                  minutes: null,
                  date: null,
                },
              }),
              entry({
                userId: 'u2',
                displayName: 'Борис Ночной',
                order: 1,
                pressedAt: '2026-11-20T12:26:00.000Z',
                result: {
                  text: 'Проверил смежные разделы',
                  messageIds: [],
                  fileCount: 0,
                  minutes: null,
                  date: null,
                },
              }),
            ],
          },
        } as unknown as Partial<TaskDetail>)}
      />,
    );
    expect(screen.getByText('Согласовал раздел ОВ1')).toBeTruthy();
    expect(screen.getByText('Проверил смежные разделы')).toBeTruthy();
    expect(screen.getByText(/Анна Ночная/)).toBeTruthy();
    expect(screen.getByText(/Борис Ночной/)).toBeTruthy();
    // Выбывший подписан пометкой — видно, что вклад его и он сохранён.
    expect(screen.getByText('результат сохранён')).toBeTruthy();
    // Правка итога недоступна: он собран из отметок.
    expect(screen.queryByRole('button', { name: /Изменить/i })).toBeNull();
  });

  it('без закрытого сбора показывает обычный результат задачи', () => {
    render(
      <TaskResultSection
        task={task({
          result: {
            text: 'Обычный итог',
            messageIds: [],
            author: { id: 'u1', displayName: 'Анна Ночная', avatarUrl: null },
            createdAt: '2026-11-20T12:00:00.000Z',
          },
        } as unknown as Partial<TaskDetail>)}
      />,
    );
    expect(screen.getByText('результат-вид')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Изменить/i })).toBeTruthy();
  });
});
