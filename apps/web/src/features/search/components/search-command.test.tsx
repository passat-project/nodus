// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const mocks = vi.hoisted(() => ({
  openHit: vi.fn(),
  pushRecent: vi.fn(),
  registerComposer: vi.fn(),
  unregisterComposer: vi.fn(),
  useSearchResults: vi.fn(),
  searchHits: vi.fn(),
  searchFacets: vi.fn(),
  searchHint: vi.fn(),
}));

vi.mock('../api/search-api.js', () => ({
  useSearchResults: mocks.useSearchResults,
  searchHits: mocks.searchHits,
  searchFacets: mocks.searchFacets,
  searchHint: mocks.searchHint,
}));
vi.mock('../lib/open-result.js', () => ({ useOpenSearchHit: () => mocks.openHit }));
vi.mock('../model/use-recent-searches.js', () => ({
  useRecentSearches: () => ({ items: [], push: mocks.pushRecent, clear: vi.fn() }),
}));
vi.mock('../../../shared/chat/composer-focus.js', () => ({
  registerComposer: mocks.registerComposer,
  unregisterComposer: mocks.unregisterComposer,
}));
vi.mock('../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => false,
}));
vi.mock('../../../shared/api/projects-list.js', () => ({
  useProjectsList: () => ({ data: { items: [] } }),
}));
vi.mock('../../../shared/lib/use-debounced-value.js', () => ({
  useDebouncedValue: (value: string) => value,
}));

import { ApiError } from '../../../shared/api-client.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useSearchStore } from '../model/search-store.js';
import { SearchCommand } from './search-command.js';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const employeeHit = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'employee',
  title: 'Администратор портала',
  snippet: '',
  score: 0.9,
  match: 'exact',
  reasons: ['title'],
  sourceCreatedAt: '2026-11-10T09:00:00.000Z',
  meta: { positionName: 'Директор', departmentName: 'Офис', email: null },
} as unknown as SearchHit;

const results = (overrides: Record<string, unknown> = {}) => ({
  data: undefined,
  isFetching: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
  ...overrides,
});

beforeEach(() => {
  mocks.openHit.mockReset();
  mocks.pushRecent.mockReset();
  mocks.searchHits.mockReturnValue([]);
  mocks.searchFacets.mockReturnValue({});
  mocks.searchHint.mockReturnValue(null);
  mocks.useSearchResults.mockReturnValue(results());
  useAuthStore.setState({ user: { id: 'user-1' } } as never);
  useSearchStore.setState({
    open: true,
    query: '',
    types: [],
    projectId: null,
    period: 'any',
    sort: 'relevance',
  });
});
afterEach(cleanup);

describe('окно поиска (#952)', () => {
  it('пустое поле — подсказка начать ввод', () => {
    render(<SearchCommand />);
    expect(screen.getByText(ui.search.startHint)).toBeTruthy();
  });

  it('выдача: строка результата, клик открывает и пишет недавнее', () => {
    vi.mocked(mocks.searchHits).mockReturnValue([employeeHit]);
    render(<SearchCommand />);
    fireEvent.change(screen.getByPlaceholderText(ui.search.placeholder), {
      target: { value: 'админ' },
    });
    const option = screen.getByRole('option', { name: /Администратор портала/ });
    fireEvent.click(option);
    expect(mocks.openHit).toHaveBeenCalledWith(employeeHit);
    expect(mocks.pushRecent).toHaveBeenCalledWith('админ');
  });

  it('ошибка и таймаут — разные тексты с retry', () => {
    mocks.useSearchResults.mockReturnValue(results({ isError: true, error: new Error('boom') }));
    const { unmount } = render(<SearchCommand />);
    fireEvent.change(screen.getByPlaceholderText(ui.search.placeholder), {
      target: { value: 'админ' },
    });
    expect(screen.getByText(ui.search.errorTitle)).toBeTruthy();
    unmount();

    mocks.useSearchResults.mockReturnValue(
      results({ isError: true, error: new ApiError('SEARCH_TIMEOUT', 'timeout', 504) }),
    );
    render(<SearchCommand />);
    fireEvent.change(screen.getByPlaceholderText(ui.search.placeholder), {
      target: { value: 'админ' },
    });
    expect(screen.getByText(ui.search.timeoutTitle)).toBeTruthy();
  });

  it('пустая выдача: подсказка про наполнение индекса', () => {
    mocks.searchHint.mockReturnValue('index_empty');
    render(<SearchCommand />);
    fireEvent.change(screen.getByPlaceholderText(ui.search.placeholder), {
      target: { value: 'админ' },
    });
    expect(screen.getByText(ui.search.hintIndexEmpty)).toBeTruthy();
  });

  it('«Показать ещё» листает следующую страницу', () => {
    const fetchNextPage = vi.fn();
    mocks.searchHits.mockReturnValue([employeeHit]);
    mocks.useSearchResults.mockReturnValue(results({ hasNextPage: true, fetchNextPage }));
    render(<SearchCommand />);
    fireEvent.change(screen.getByPlaceholderText(ui.search.placeholder), {
      target: { value: 'админ' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.search.showMore }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('крестик: с текстом очищает запрос, с пустым — закрывает окно', () => {
    render(<SearchCommand />);
    const input = screen.getByPlaceholderText(ui.search.placeholder);
    fireEvent.change(input, { target: { value: 'админ' } });
    fireEvent.click(screen.getByRole('button', { name: ui.search.clear }));
    expect(useSearchStore.getState().query).toBe('');
    fireEvent.click(screen.getByRole('button', { name: ui.search.close }));
    expect(useSearchStore.getState().open).toBe(false);
  });
});
