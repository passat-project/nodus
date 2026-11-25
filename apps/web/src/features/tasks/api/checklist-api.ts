import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ChecklistItem, TaskDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { publishOptimisticTask, restoreTaskOverlay } from '../../../shared/api/task-cache.js';
import { invalidateAfterTaskMutation } from '../../../shared/api/task-invalidate.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';

/** Пункты чек-листа карточки (I4): мгновенно в кэш детали, счётчики
 *  пересчитываются локально; сервер отвечает ПУНКТОМ (контракт #37), не
 *  задачей — деталь патчится, а не заменяется. После — переходы (гейт
 *  checklist_complete), доски и журнал (бейдж «n/m») инвалидацией. */

function patchChecklist(
  queryClient: QueryClient,
  taskId: string,
  fn: (items: ChecklistItem[]) => ChecklistItem[],
): TaskDetail | undefined {
  const previous = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
  if (!previous) return undefined;
  const checklist = fn(previous.checklist);
  queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), {
    ...previous,
    checklist,
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((i) => i.done).length,
  });
  return previous;
}

/** Бейдж «n/m» на карточке доски — оверлеем (#1051): сервер отвечает пунктом,
 *  а не строкой задачи, поэтому после ответа публикуется итоговое значение. */
function publishChecklistCounts(queryClient: QueryClient, taskId: string, optimistic: boolean) {
  const detail = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
  if (!detail) return undefined;
  return publishOptimisticTask(
    queryClient,
    taskId,
    () => ({
      checklistTotal: detail.checklist.length,
      checklistDone: detail.checklist.filter((i) => i.done).length,
    }),
    optimistic,
  );
}

function useChecklistMutation<V>(
  taskId: string,
  request: (vars: V) => Promise<ChecklistItem | void>,
  optimistic: (vars: V, items: ChecklistItem[]) => ChecklistItem[],
  reconcile?: (vars: V, server: ChecklistItem, items: ChecklistItem[]) => ChecklistItem[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onMutate: async (vars: V) => {
      await queryClient.cancelQueries({ queryKey: tasksKeys.detail(taskId) });
      const previous = patchChecklist(queryClient, taskId, (items) => optimistic(vars, items));
      const previousItem = publishChecklistCounts(queryClient, taskId, true);
      return { previous, previousItem };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(tasksKeys.detail(taskId), context.previous);
      restoreTaskOverlay(context?.previousItem);
      toast.error(ui.common.saveError);
    },
    onSuccess: (server, vars) => {
      if (server && reconcile)
        patchChecklist(queryClient, taskId, (items) => reconcile(vars, server, items));
      publishChecklistCounts(queryClient, taskId, false);
    },
    // Гейт checklist_complete — в переходах; доски и журнал догоняет эхо (#1051):
    // прежде каждый клик по пункту инвалидировал десять ключей.
    onSettled: () => invalidateAfterTaskMutation(queryClient, taskId),
  });
}

export function useAddChecklistItem(taskId: string) {
  return useChecklistMutation<{ text: string; tempId: string }>(
    taskId,
    ({ text }) =>
      api<ChecklistItem>(`/tasks/${taskId}/checklist`, { method: 'POST', body: { text } }),
    ({ text, tempId }, items) => [...items, { id: tempId, text, done: false }],
    ({ tempId }, server, items) => items.map((i) => (i.id === tempId ? server : i)),
  );
}

export function useToggleChecklistItem(taskId: string) {
  return useChecklistMutation<{ itemId: string; done: boolean }>(
    taskId,
    ({ itemId, done }) =>
      api<ChecklistItem>(`/tasks/${taskId}/checklist/${itemId}`, {
        method: 'PATCH',
        body: { done },
      }),
    ({ itemId, done }, items) => items.map((i) => (i.id === itemId ? { ...i, done } : i)),
  );
}

export function useDeleteChecklistItem(taskId: string) {
  return useChecklistMutation<{ itemId: string }>(
    taskId,
    ({ itemId }) => api<void>(`/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' }),
    ({ itemId }, items) => items.filter((i) => i.id !== itemId),
  );
}
