// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TasksPage } from './tasks-page.js';

/**
 * #956: строка инструментов страницы «Задачи» ищет на сервере. Debounced
 * запрос обязан дойти до обоих видов (журнал и «Мой план») — иначе фильтр
 * снова ограничится загруженной страницей/колонками.
 */

const { listProps, kanbanProps, viewState, toolbar } = vi.hoisted(() => ({
  listProps: { current: null as Record<string, unknown> | null },
  kanbanProps: { current: null as Record<string, unknown> | null },
  viewState: { view: 'list' },
  toolbar: { query: 'Смета', filters: {}, setFilter: vi.fn() },
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ view: viewState.view }),
}));
vi.mock('../components/task-list.js', () => ({
  TaskList: (props: Record<string, unknown>) => {
    listProps.current = props;
    return null;
  },
}));
vi.mock('../components/task-kanban.js', () => ({
  TaskKanban: (props: Record<string, unknown>) => {
    kanbanProps.current = props;
    return null;
  },
}));
vi.mock('../../../shared/views/list-toolbar.js', () => ({ ListToolbar: () => null }));
vi.mock('../../../shared/views/view-settings.js', () => ({ ViewSettings: () => null }));
vi.mock('../../../shared/views/use-list-toolbar.js', () => ({
  useListToolbar: () => toolbar,
}));
vi.mock('../../../shared/lib/use-debounced-value.js', () => ({
  useDebouncedValue: (value: string) => value,
}));
vi.mock('../../../shared/api/task-stages.js', () => ({ useTaskStages: () => ({ data: [] }) }));
vi.mock('../../../shared/api/projects-available.js', () => ({ projectsAvailable: () => true }));
vi.mock('../../../shared/views/task-card-fields.js', () => ({ useTaskCardFields: () => [] }));
vi.mock('../../../shared/views/task-filter-fields.js', () => ({
  taskBuiltinPresets: [],
  taskListPresets: [],
  taskSearchText: () => '',
  useTaskFilterDefs: () => [],
}));
vi.mock('../lib/task-fields.js', () => ({ useTaskListFields: () => [] }));
vi.mock('../../../shared/tasks/task-create-store.js', () => ({ openTaskCreate: vi.fn() }));
// #435: журнал тянет реестр атрибутов, плоский реестр колонок и виды рамки.
vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));
vi.mock('../../../shared/views/task-table-fields.js', () => ({ useTaskTableFields: () => [] }));
vi.mock('../../../shared/views/list-ext/saved-views-api.js', () => ({
  useJournalSavedViews: () => ({ data: [] }),
  useCreateSavedView: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSavedView: () => ({ mutate: vi.fn() }),
}));

beforeEach(() => {
  listProps.current = null;
  kanbanProps.current = null;
  viewState.view = 'list';
});

afterEach(() => {
  cleanup();
});

describe('TasksPage — серверный поиск (#956)', () => {
  it('журнал получает debounced search и пустой клиентский query', () => {
    render(<TasksPage />);

    expect(listProps.current?.search).toBe('Смета');
    expect((listProps.current?.filter as { query?: string }).query).toBe('');
  });

  it('доска «Мой план» получает тот же search', () => {
    viewState.view = 'kanban';
    render(<TasksPage />);

    expect(kanbanProps.current?.search).toBe('Смета');
  });
});
