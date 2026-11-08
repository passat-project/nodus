import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NumberCountsResponse,
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

/** «Проверка на записи»: запись → её реальный контейнер → следующий номер.
 *  Номер не тратится. */
export function useNumberPreview() {
  return useMutation({
    mutationFn: (body: NumberPreviewBody) =>
      api<NumberPreviewResult>('/custom-fields/numbering/preview', { method: 'POST', body }),
  });
}
