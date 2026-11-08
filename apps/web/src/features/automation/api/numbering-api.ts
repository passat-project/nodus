import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NumberBackfillBody,
  NumberBackfillPreview,
  NumberBackfillResult,
  NumberCoverageBody,
  NumberCoverageResult,
  NumberCountsResponse,
  NumberHostAssignments,
  NumberHostKind,
  NumberPreviewBody,
  NumberPreviewResult,
  SetNumberNextBody,
} from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { customFieldsKeys } from '../../../shared/custom-fields/queries.js';

/** Ключи счетов счётчика (#630): «Текущие счета» атрибута с поиском. */
export const numberingKeys = {
  all: ['numbering'] as const,
  counts: (definitionId: string, q: string) => ['numbering', 'counts', definitionId, q] as const,
};

/** «Текущие счета»: контейнеры с последним и следующим номером. */
export function useNumberCounts(definitionId: string | null, q: string) {
  return useQuery({
    queryKey: numberingKeys.counts(definitionId ?? '', q),
    queryFn: () =>
      api<NumberCountsResponse>(
        `/custom-fields/definitions/${definitionId}/numbering/counts${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
    enabled: definitionId !== null,
  });
}

/** «Следующий номер» счёта — только вперёд; ответ сервера — истина
 *  (409 NUMBER_NEXT_BACKWARDS показывает вызывающий). */
export function useSetNumberNext(definitionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SetNumberNextBody) =>
      api<NumberCountsResponse>(`/custom-fields/definitions/${definitionId}/numbering/next`, {
        method: 'PUT',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: numberingKeys.all });
      void queryClient.invalidateQueries({ queryKey: customFieldsKeys.all });
    },
  });
}

/** Охват правила: сколько существующих записей отмеченных типов лежат
 *  внутри выбранного счёта (пересчёт при каждой правке черновика). */
export function useNumberCoverage(body: NumberCoverageBody | null) {
  return useQuery({
    queryKey: ['numbering', 'coverage', body] as const,
    queryFn: () =>
      api<NumberCoverageResult>('/custom-fields/numbering/coverage', { method: 'POST', body }),
    enabled: body !== null,
    placeholderData: (previous) => previous,
  });
}

/** «Проверка на записи»: запись → значения её условий → следующий номер.
 *  Номер не тратится. */
export function useNumberPreview() {
  return useMutation({
    mutationFn: (body: NumberPreviewBody) =>
      api<NumberPreviewResult>('/custom-fields/numbering/preview', { method: 'POST', body }),
  });
}

/** Выдача существующим — предпросмотр (ничего не тратит): сколько, где,
 *  первые/последние номера, кто не получит и почему. */
export function useNumberBackfillPreview(definitionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['numbering', 'backfill', definitionId] as const,
    queryFn: () =>
      api<NumberBackfillPreview>(
        `/custom-fields/definitions/${definitionId}/numbering/backfill/preview`,
        { method: 'POST', body: {} },
      ),
    enabled,
  });
}

/** Выдача существующим — одобрение: число записей из предпросмотра
 *  сверяется сервером (409 NUMBER_BACKFILL_STALE — показать свежий). */
export function useNumberBackfill(definitionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: NumberBackfillBody) =>
      api<NumberBackfillResult>(`/custom-fields/definitions/${definitionId}/numbering/backfill`, {
        method: 'POST',
        body,
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: numberingKeys.all });
      void queryClient.invalidateQueries({ queryKey: customFieldsKeys.all });
    },
  });
}

/** Номера одной записи: кто, когда, каким способом и в каком счёте выдал. */
export function useNumberHostAssignments(kind: NumberHostKind, id: string | null) {
  return useQuery({
    queryKey: ['numbering', 'host', kind, id] as const,
    queryFn: () => api<NumberHostAssignments>(`/custom-fields/numbering/host/${kind}/${id}`),
    enabled: id !== null,
  });
}
