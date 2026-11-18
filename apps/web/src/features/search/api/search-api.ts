import type { SearchRequest, SearchSort, SearchSourceType } from '@nodus/contracts';

import { SEARCH_PAGE_SIZE, useSearchHits } from '../../../shared/api/search.js';
import { SEARCH_PERIOD_DAYS, type SearchPeriod } from '../model/search-store.js';

/** Выдача поиска и чистые помощники — общий слой `shared/api/search` (#956):
 *  панель сообщений открытого чата использует те же ключи и формат запроса.
 *  Здесь остаётся только специфика окна: `period` → `from` и `SearchParams`. */
export {
  SEARCH_PAGE_SIZE,
  searchFacets,
  searchHint,
  searchHits,
  searchKeys,
  searchPath,
} from '../../../shared/api/search.js';

/** Параметры окна поиска (стор) → запрос API. */
export interface SearchParams {
  q: string;
  types?: SearchSourceType[];
  projectId?: string | null;
  period?: SearchPeriod;
  sort?: SearchSort;
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** `period` → `from` по UTC-дню (сервер фильтрует по `sourceCreatedAt`). */
export function searchRequestOf(params: SearchParams): SearchRequest {
  const request: SearchRequest = {
    q: params.q.trim(),
    sort: params.sort ?? 'relevance',
    limit: SEARCH_PAGE_SIZE,
  };
  if (params.types && params.types.length > 0) request.types = params.types;
  if (params.projectId) request.projectId = params.projectId;
  const period = params.period ?? 'any';
  if (period !== 'any') {
    request.from = isoDay(new Date(Date.now() - SEARCH_PERIOD_DAYS[period] * 86_400_000));
  }
  return request;
}

/**
 * Выдача окна поиска (Ctrl+K). `keepPreviousData` — старые результаты
 * остаются до ответа на новый запрос: выдача не мелькает при вводе.
 */
export function useSearchResults(params: SearchParams) {
  const request = searchRequestOf(params);
  return useSearchHits(request, { enabled: request.q.length >= 2 });
}
