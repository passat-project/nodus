import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type {
  CustomFieldRef,
  CustomFieldValue,
  Paginated,
  TaskDetail,
  TaskListItem,
} from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import {
  fieldErrorText,
  mergedRefs,
  patchedValues,
} from '../../../shared/custom-fields/value-patch.js';
import { mapTaskInPages, taskDependentKeys, tasksKeys } from '../../../shared/api/tasks-keys.js';
import { fieldLockedText } from '../../../shared/forms/field-lock-ui.js';

/** Правка одного кастомного поля карточки (#431, I4): значение в детали и
 *  журналах меняется сразу, `null` удаляет ключ; ссылка выбора (имя, аватар)
 *  кладётся в `customFieldRefs` до ответа сервера (Р6). Откат — по снапшотам
 *  всех патчимых кэшей (канон patterns.md). */
export function useUpdateTaskCustomField(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      fieldId: string;
      value: CustomFieldValue | null;
      /** Ссылка выбора — для мгновенного показа имени (в тело не уходит). */
      refs?: readonly CustomFieldRef[];
      /** Причина правки закреплённого поля (#496). */
      lockReason?: string;
    }) =>
      api<TaskListItem>(`/tasks/${taskId}`, {
        method: 'PATCH',
        body: {
          customFields: { [vars.fieldId]: vars.value },
          ...(vars.lockReason ? { lockReason: vars.lockReason } : {}),
        },
      }),
    onMutate: async (vars) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: tasksKeys.detail(taskId) }),
        queryClient.cancelQueries({ queryKey: tasksKeys.listPages() }),
      ]);
      const previous = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
      const previousPages = queryClient.getQueriesData<InfiniteData<Paginated<TaskListItem>>>({
        queryKey: tasksKeys.listPages(),
      });
      if (previous) {
        queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), {
          ...previous,
          customFields: patchedValues(previous.customFields, vars.fieldId, vars.value),
          customFieldRefs: mergedRefs(previous.customFieldRefs, vars.refs),
        });
      }
      queryClient.setQueriesData<InfiniteData<Paginated<TaskListItem>>>(
        { queryKey: tasksKeys.listPages() },
        (old) =>
          mapTaskInPages(old, taskId, (row) => ({
            ...row,
            customFields: patchedValues(row.customFields, vars.fieldId, vars.value),
          })),
      );
      return { previous, previousPages };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(tasksKeys.detail(taskId), context.previous);
      for (const [key, data] of context?.previousPages ?? []) queryClient.setQueryData(key, data);
      toast.error(fieldLockedText(error) ?? fieldErrorText(error));
    },
    onSettled: () => {
      for (const key of taskDependentKeys(taskId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
