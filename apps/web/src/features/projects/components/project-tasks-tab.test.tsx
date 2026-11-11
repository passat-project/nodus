// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { ProjectTasksTab } from './project-tasks-tab.js';

const { openTaskCreate } = vi.hoisted(() => ({ openTaskCreate: vi.fn() }));

vi.mock('../../../shared/tasks/task-create-store.js', () => ({ openTaskCreate }));
vi.mock('../../../shared/views/use-list-toolbar.js', () => ({
  useListToolbar: () => ({
    filters: {},
    query: '',
    presets: [],
    setQuery: vi.fn(),
    setFilter: vi.fn(),
  }),
}));
vi.mock('../../../shared/views/list-filters.js', () => ({
  isActiveFilter: () => false,
  filterValueLabel: () => '',
}));
vi.mock('../../../shared/views/task-filter-fields.js', () => ({
  taskBuiltinPresets: [],
  taskSearchText: () => '',
  useTaskFilterDefs: () => [],
}));
vi.mock('../../../shared/views/task-table-fields.js', () => ({
  useTaskTableFields: () => [],
}));
vi.mock('../../../shared/views/task-card-fields.js', () => ({
  useTaskCardFields: () => [],
}));
vi.mock('../../../shared/views/view-settings.js', () => ({ ViewSettings: () => null }));
vi.mock('./project-task-list.js', () => ({
  ProjectTaskList: ({ projectId }: { projectId: string }) => <div>list:{projectId}</div>,
}));
vi.mock('./project-kanban.js', () => ({
  ProjectKanban: ({ projectId }: { projectId: string }) => <div>kanban:{projectId}</div>,
}));

/** Шапка вкладки-списка карточки проекта (#736): кнопка создания и
 *  переключатель вида живут в `CardTabToolbar`, действия не сломаны. */
describe('ProjectTasksTab (#736)', () => {
  afterEach(() => cleanup());

  it('создание открывает задачу проекта, переключатель меняет вид', () => {
    render(<ProjectTasksTab projectId="p-1" />);

    expect(screen.getByText('list:p-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    expect(openTaskCreate).toHaveBeenCalledWith({ projectId: 'p-1' });

    fireEvent.click(screen.getByRole('button', { name: ui.tasks.viewKanban }));
    expect(screen.getByText('kanban:p-1')).toBeTruthy();
  });
});
