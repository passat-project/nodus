// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSearchResults } from './search-api.js';

/**
 * #956: окно поиска переехало на общий слой `shared/api/search` (панель
 * сообщений открытого чата использует те же запросы). Окно обязано передать
 * собранный запрос и порог в 2 символа дальше — без него в сеть уходил бы
 * каждый односимвольный ввод.
 */

const { hits } = vi.hoisted(() => ({ hits: vi.fn(() => ({ data: undefined })) }));

vi.mock('../../../shared/api/search.js', () => ({
  SEARCH_PAGE_SIZE: 20,
  useSearchHits: hits,
  searchFacets: vi.fn(),
  searchHint: vi.fn(),
  searchHits: vi.fn(),
  searchKeys: { all: ['search'], results: vi.fn() },
  searchPath: vi.fn(),
}));

describe('useSearchResults — общий слой выдачи (#956)', () => {
  it('запрос окна уходит в useSearchHits с порогом 2 символа', () => {
    renderHook(() => useSearchResults({ q: '  смета ', types: ['task'] }));

    expect(hits).toHaveBeenCalledWith(
      { q: 'смета', sort: 'relevance', limit: 20, types: ['task'] },
      { enabled: true },
    );
  });

  it('один символ — запрос не включается', () => {
    renderHook(() => useSearchResults({ q: 'с' }));

    expect(hits).toHaveBeenCalledWith({ q: 'с', sort: 'relevance', limit: 20 }, { enabled: false });
  });
});
