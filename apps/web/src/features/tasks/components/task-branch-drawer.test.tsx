// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

const quick = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('../api/tasks-api.js', () => ({
  useTaskBranch: () => ({
    data: { root: { id: 't1', title: 'Корень', number: 1, hidden: false, children: [] } },
  }),
  useTaskRelations: () => ({ data: [] }),
}));

vi.mock('../../../shared/tasks/quick-create.js', () => ({
  useQuickCreate: () => quick,
}));

import { TaskBranchDrawer } from './task-branch-drawer.js';

/** Навигатор ветки (#843): Esc в быстром создании подзадачи гасит только
 *  строку ввода, а не карточку/слайдер под ней. */
describe('TaskBranchDrawer: Esc в быстром создании подзадачи', () => {
  afterEach(() => {
    cleanup();
    quick.run.mockClear();
  });

  it('Esc отменяет ввод и не всплывает до карточки', () => {
    const onKeyDown = vi.fn();
    render(
      <div onKeyDown={onKeyDown}>
        <TaskBranchDrawer
          rootId="t1"
          currentId="t1"
          canBack={false}
          onBack={vi.fn()}
          onNavigate={vi.fn()}
          onClose={vi.fn()}
        />
      </div>,
    );

    // Одноимённые кнопки: вкладка «Подзадачи» и «+» у строки — плюс последний.
    const addButtons = screen.getAllByRole('button', { name: ui.tasks.subtasks });
    fireEvent.click(addButtons.at(-1)!);
    const input = screen.getByPlaceholderText(ui.tasks.subtaskPlaceholder);
    fireEvent.change(input, { target: { value: 'Подзадача' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByPlaceholderText(ui.tasks.subtaskPlaceholder)).toBeNull();
    expect(quick.run).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
