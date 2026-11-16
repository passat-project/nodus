import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type {
  LetterDetail,
  LetterHistoryEntry,
  LetterResolvers,
  Paginated,
  ProcessType,
  WorkflowAction,
  WorkflowTransition,
} from '@nodus/contracts';
import { SystemDictionary } from '@nodus/contracts';

import { ApiError, api } from '../../../shared/api-client.js';
import { lettersKeys } from '../../../shared/api/letters-keys.js';
import { useDictionaryItems } from '../../../shared/dictionaries/queries.js';

/** Чтение корреспонденции (#55, §7.3). Списки вкладок — shared
 *  `useLettersInfinite` (общий с CRM и палитрой). */

const notFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/** Карточка письма: 404 (нет/не видно) не повторяется — объяснение сразу. */
export function useLetterDetail(id: string) {
  return useQuery({
    queryKey: lettersKeys.detail(id),
    queryFn: () => api<LetterDetail>(`/letters/${id}`),
    enabled: id.length > 0 && !id.startsWith('temp-'),
    retry: (count, error) => !notFound(error) && count < 2,
  });
}

/** Префетч карточки по ховеру строки журнала: первое открытие слайдера
 *  рисует контент одним проходом, без скелета. Беседу письма не трогаем. */
export function usePrefetchLetter() {
  const queryClient = useQueryClient();
  return useCallback(
    (id: string) => {
      void queryClient.prefetchQuery({
        queryKey: lettersKeys.detail(id),
        queryFn: () => api<LetterDetail>(`/letters/${id}`),
        staleTime: 30_000,
      });
    },
    [queryClient],
  );
}

/** Кнопки маршрута письма (сервер решает, кому какие — условия движка). */
export function useLetterTransitions(id: string, enabled = true) {
  return useQuery({
    queryKey: lettersKeys.transitions(id),
    queryFn: () => api<WorkflowTransition[]>(`/letters/${id}/transitions`),
    enabled: enabled && id.length > 0,
    staleTime: 30_000,
  });
}

/** Действия письма без смены статуса (#633, аудит В1): та же панель кнопок,
 *  что у задачи — опубликованное действие письма нажимается. */
export function useLetterActions(id: string, enabled = true) {
  return useQuery({
    queryKey: lettersKeys.actions(id),
    queryFn: () => api<WorkflowAction[]>(`/letters/${id}/actions`),
    enabled: enabled && id.length > 0,
    staleTime: 30_000,
  });
}

/** Журнал письма курсором (новые сверху, «Показать ещё» — старые). */
export function useLetterHistory(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: lettersKeys.history(id),
    queryFn: ({ pageParam, signal }) =>
      api<Paginated<LetterHistoryEntry>>(
        `/letters/${id}/history${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** «Принимают решения» — держатели `correspondence.resolve` (редко меняется). */
export function useLetterResolvers() {
  return useQuery({
    queryKey: lettersKeys.resolvers(),
    queryFn: () => api<LetterResolvers>('/letters/resolvers'),
    staleTime: 5 * 60_000,
  });
}

/** Способы поступления (Р14) — системный справочник. */
export function useReceiptMethods() {
  return useDictionaryItems(SystemDictionary.RECEIPT_METHOD);
}

/** Типы писем: префикс серии номера («Вх»), выбор типа ручного создания. */
export function useLetterTypes() {
  return useQuery({
    queryKey: lettersKeys.types(),
    queryFn: () => api<ProcessType[]>('/workflows/types?category=letter'),
    staleTime: 5 * 60_000,
  });
}
