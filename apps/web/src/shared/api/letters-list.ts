import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import {
  LETTER_LIMITS,
  type LetterBox,
  type LetterListItem,
  type ListResult,
  type Paginated,
} from '@nodus/contracts';

import { api } from '../api-client.js';
import { lettersKeys, type LettersListFilters } from './letters-keys.js';
import {
  applyExtParams,
  hasListExtParams,
  type ListExtParams,
} from '../views/list-ext/list-ext-query.js';

export type LettersPages = InfiniteData<Paginated<LetterListItem>>;

function listPath(
  box: LetterBox | null,
  filters: LettersListFilters,
  cursor: string | null,
  ext?: ListExtParams,
) {
  const params = new URLSearchParams();
  if (box) params.set('box', box);
  // Длиннее лимита контракта сервер ответил бы 400 — режем здесь, у всех потребителей.
  if (filters.search) params.set('search', filters.search.slice(0, LETTER_LIMITS.search));
  if (filters.counterpartyId) params.set('counterpartyId', filters.counterpartyId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (cursor) params.set('cursor', cursor);
  if (ext && hasListExtParams(ext)) applyExtParams(params, ext);
  const qs = params.toString();
  return `/letters${qs ? `?${qs}` : ''}`;
}

/** Список писем курсором — ОДИН хук на продукт (#55, ключ shared): вкладки
 *  «Новые»/«Входящие»/«Исходящие», вкладка «Письма» контрагента, палитра.
 *  Сервер сортирует сам (новые — по поступлению, журналы — по регистрации);
 *  поиск — серверный. `enabled: false` — блок связи не запрашивается.
 *  #435: ext (фильтр/сортировка/группировка/итоги) — сервер считает по всей
 *  выборке ящика, ответ — ListResult. */
export function useLettersInfinite(
  box: LetterBox | null,
  filters: LettersListFilters = {},
  options: { enabled?: boolean; ext?: ListExtParams } = {},
) {
  const ext = options.ext;
  const extKey = ext !== undefined && hasListExtParams(ext) ? JSON.stringify(ext) : undefined;
  const queryKey = [...lettersKeys.list(box, filters), ...(extKey ? [{ ext: extKey }] : [])];
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      api<ListResult<LetterListItem>>(listPath(box, filters, pageParam, ext), { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: options.enabled ?? true,
    staleTime: 30_000,
    // Новый поисковый запрос — прежние строки до ответа (список не мигает
    // скелетом на каждую букву); смена вкладки или контрагента — честная
    // загрузка, без чужих строк.
    placeholderData: (previous, previousQuery) =>
      previousQuery !== undefined &&
      previousQuery.queryKey[2] === queryKey[2] &&
      sameCounterparty(
        previousQuery.queryKey[3] as { counterpartyId?: string } | undefined,
        queryKey[3] as { counterpartyId: string },
      )
        ? previous
        : undefined,
  });
}

function sameCounterparty(a: unknown, b: { counterpartyId: string }): boolean {
  return (a as { counterpartyId?: string } | undefined)?.counterpartyId === b.counterpartyId;
}

/** Строки всех загруженных страниц. */
export function letterRows(data: LettersPages | undefined): LetterListItem[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

/** Правка письма во всех страницах (оптимистичные патчи — через
 *  `pages[].items`, gotcha #460: плоский `items` у infinite-кэша не живёт). */
export function mapLetterInPages(
  data: LettersPages | undefined,
  id: string,
  map: (letter: LetterListItem) => LetterListItem | null,
): LettersPages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((letter) => {
        if (letter.id !== id) return [letter];
        const next = map(letter);
        return next ? [next] : [];
      }),
    })),
  };
}
