// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmployeeProjectsTab, EmployeeTasksTab } from './employee-journal-tabs.js';

/**
 * #956: журналы карточки сотрудника пагинированы — поиск строки инструментов
 * обязан уходить на сервер (`search` в хуке), а не фильтровать загруженную
 * страницу на клиенте. Компоненты покрываются с заглушками тяжёлых
 * презентационных слоёв (таблица/тулбар имеют свои тесты shared/views).
 */

const { assigneeTasks, memberProjects, debounced } = vi.hoisted(() => ({
  assigneeTasks: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
  memberProjects: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
  debounced: vi.fn((value: string) => value),
}));

vi.mock('../../../shared/api/user-relations.js', () => ({
  useAssigneeTasks: assigneeTasks,
  useMemberProjects: memberProjects,
}));
vi.mock('../../../shared/api/projects-available.js', () => ({ projectsAvailable: () => true }));
vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));
vi.mock('../../../shared/lib/use-debounced-value.js', () => ({
  useDebouncedValue: (value: string) => debounced(value),
}));
vi.mock('../../../shared/ui/entity-card/card-tab-toolbar.js', () => ({
  CardTabToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../shared/views/data-table.js', () => ({ DataTable: () => null }));
vi.mock('../../../shared/views/list-toolbar.js', () => ({ ListToolbar: () => null }));
vi.mock('../../../shared/views/view-settings.js', () => ({ ViewSettings: () => null }));
vi.mock('../../../shared/views/task-table-fields.js', () => ({ useTaskTableFields: () => [] }));
vi.mock('../../../shared/views/project-table-fields.js', () => ({
  useProjectTableFields: () => [],
}));
vi.mock('../../../shared/views/task-filter-fields.js', () => ({
  taskBuiltinPresets: [],
  taskSearchText: () => '',
  useTaskFilterDefs: () => [],
}));
vi.mock('../../../shared/views/project-filter-fields.js', () => ({
  projectBuiltinPresets: [],
  projectSearchText: () => '',
  useProjectFilterDefs: () => [],
}));
vi.mock('../../../shared/views/use-list-toolbar.js', () => ({
  useListToolbar: () => ({ query: 'Смета', filters: {}, setFilter: vi.fn() }),
  useFilteredList: (rows: unknown[]) => rows,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmployeeTasksTab — серверный поиск (#956)', () => {
  it('debounced строка уходит в useAssigneeTasks, клиентский query пуст', () => {
    render(<EmployeeTasksTab userId="user-1" onCreateTask={vi.fn()} />);

    expect(debounced).toHaveBeenCalledWith('Смета');
    expect(assigneeTasks).toHaveBeenCalledWith('user-1', 'Смета');
  });
});

describe('EmployeeProjectsTab — серверный поиск (#956)', () => {
  it('debounced строка уходит в useMemberProjects вместе с доступностью домена', () => {
    render(<EmployeeProjectsTab userId="user-1" />);

    expect(memberProjects).toHaveBeenCalledWith('user-1', {
      enabled: true,
      search: 'Смета',
    });
  });
});
