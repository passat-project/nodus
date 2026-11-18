// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CounterpartyProjectsTab } from './counterparty-related.js';

/**
 * #956: проекты заказчика в карточке контрагента пагинированы (курсор,
 * limit=100) — поиск уходит на сервер вместе с `enabled` вкладки, а не
 * фильтрует загруженную страницу. Презентационные слои — заглушки.
 */

const { clientProjects, debounced } = vi.hoisted(() => ({
  clientProjects: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
  debounced: vi.fn((value: string) => value),
}));

vi.mock('../../../shared/api/counterparty-relations.js', () => ({
  useClientProjects: clientProjects,
}));
vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));
vi.mock('../../../shared/lib/use-debounced-value.js', () => ({
  useDebouncedValue: (value: string) => debounced(value),
}));
vi.mock('../../../shared/views/data-table.js', () => ({ DataTable: () => null }));
vi.mock('../../../shared/views/list-toolbar.js', () => ({ ListToolbar: () => null }));
vi.mock('../../../shared/views/view-settings.js', () => ({ ViewSettings: () => null }));
vi.mock('../../../shared/views/project-table-fields.js', () => ({
  useProjectTableFields: () => [],
}));
vi.mock('../../../shared/views/use-list-toolbar.js', () => ({
  useListToolbar: () => ({ query: 'Смета', filters: {}, setFilter: vi.fn() }),
  useFilteredList: (rows: unknown[]) => rows,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CounterpartyProjectsTab — серверный поиск (#956)', () => {
  it('debounced строка и enabled уходят в useClientProjects', () => {
    render(<CounterpartyProjectsTab counterpartyId="c-1" enabled />);

    expect(debounced).toHaveBeenCalledWith('Смета');
    expect(clientProjects).toHaveBeenCalledWith('c-1', { enabled: true, search: 'Смета' });
  });
});
