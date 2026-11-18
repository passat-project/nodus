import { keepPreviousData, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { SearchFacets, SearchHit, SearchRequest, SearchResponse } from '@nodus/contracts';

import { api } from '../api-client.js';

/** Размер страницы выдачи: 20; «Показать ещё» листает по курсору — до капа
 *  выдачи на сервере (total ≤ 1000), а не до отдельного клиентского окна. */
export const SEARCH_PAGE_SIZE = 20;

/** Wire-формат `GET /api/v1/search`: `types` — одна строка через запятую
 *  (контракт принимает и её, и массив; Fastify на один параметр отдаёт строку),
 *  `conversationId` — поиск внутри открытого чата (#956). */
export function searchPath(request: SearchRequest): string {
  const search = new URLSearchParams();
  search.set('q', request.q);
  if (request.types && request.types.length > 0) search.set('types', request.types.join(','));
  if (request.projectId) search.set('projectId', request.projectId);
  if (request.conversationId) search.set('conversationId', request.conversationId);
  if (request.from) search.set('from', request.from);
  if (request.to) search.set('to', request.to);
  search.set('sort', request.sort);
  search.set('limit', String(request.limit));
  if (request.cursor) search.set('cursor', request.cursor);
  return `/search?${search.toString()}`;
}

/** Ключи выдачи поиска — общий префикс `search`: окно Ctrl+K и панель
 *  сообщений чата (#956) не делят кэш (разные запросы), но инвалидации —
 *  общие. */
export const searchKeys = {
  all: ['search'] as const,
  results: (request: SearchRequest) => [...searchKeys.all, 'results', request] as const,
};

/**
 * Выдача поиска: бесконечный запрос по курсору. `keepPreviousData` — старые
 * результаты остаются до ответа на новый запрос: выдача не мелькает при вводе.
 * Общий для окна поиска (features/search) и панели сообщений открытого чата.
 */
export function useSearchHits(request: SearchRequest, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: searchKeys.results(request),
    queryFn: ({ pageParam, signal }) =>
      api<SearchResponse>(searchPath({ ...request, cursor: pageParam ?? undefined }), { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Строки всех загруженных страниц без повторов `type:id`: граница страниц
 *  по курсору может отдать одну строку дважды при вставке события между
 *  запросами (план R7). */
export function searchHits(data: InfiniteData<SearchResponse> | undefined): SearchHit[] {
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const page of data?.pages ?? []) {
    for (const hit of page.items) {
      const key = `${hit.type}:${hit.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }
  return hits;
}

export function searchFacets(
  data: InfiniteData<SearchResponse> | undefined,
): SearchFacets['types'] {
  return data?.pages[0]?.facets.types ?? {};
}

export function searchHint(data: InfiniteData<SearchResponse> | undefined) {
  return data?.pages[0]?.hint ?? null;
}
