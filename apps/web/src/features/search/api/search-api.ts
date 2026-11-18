import { keepPreviousData, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type {
  SearchFacets,
  SearchHit,
  SearchRequest,
  SearchResponse,
  SearchSort,
  SearchSourceType,
} from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { SEARCH_PERIOD_DAYS, type SearchPeriod } from '../model/search-store.js';

/** Размер страницы выдачи: 20, «Показать ещё» листает до окна топ-100. */
export const SEARCH_PAGE_SIZE = 20;

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

/** Wire-формат: `types` — одна строка через запятую (контракт принимает и её,
 *  и массив; Fastify на один параметр отдаёт строку). */
export function searchPath(request: SearchRequest): string {
  const search = new URLSearchParams();
  search.set('q', request.q);
  if (request.types && request.types.length > 0) search.set('types', request.types.join(','));
  if (request.projectId) search.set('projectId', request.projectId);
  if (request.from) search.set('from', request.from);
  if (request.to) search.set('to', request.to);
  search.set('sort', request.sort);
  search.set('limit', String(request.limit));
  if (request.cursor) search.set('cursor', request.cursor);
  return `/search?${search.toString()}`;
}

export const searchKeys = {
  all: ['search'] as const,
  results: (request: SearchRequest) => [...searchKeys.all, 'results', request] as const,
};

/**
 * Выдача поиска: бесконечный запрос по курсору. `keepPreviousData` — старые
 * результаты остаются до ответа на новый запрос: выдача не мелькает при вводе
 * (жалоба владельца на мигание), индикатор загрузки показывает `isFetching`.
 */
export function useSearchResults(params: SearchParams) {
  const request = searchRequestOf(params);
  return useInfiniteQuery({
    queryKey: searchKeys.results(request),
    queryFn: ({ pageParam, signal }) =>
      api<SearchResponse>(searchPath({ ...request, cursor: pageParam ?? undefined }), { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: request.q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function searchHits(data: InfiniteData<SearchResponse> | undefined): SearchHit[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function searchFacets(
  data: InfiniteData<SearchResponse> | undefined,
): SearchFacets['types'] {
  return data?.pages[0]?.facets.types ?? {};
}

export function searchHint(data: InfiniteData<SearchResponse> | undefined) {
  return data?.pages[0]?.hint ?? null;
}
