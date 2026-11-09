import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PressExecuteResult, PressSubmitBody, TaskDetail } from '@nodus/contracts';
import { pressEntryResultOf, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { markFreshFromMutation } from '../../../shared/api/fresh-from-mutation.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { transitionErrorText } from '../../../shared/tasks/transition-error.js';

/** Коллективная кнопка (#434): сдача и отзыв своей отметки. Сдача
 *  оптимистична (I4) — кольцо и счётчик меняются до ответа; после кворума
 *  сервер уже выполнил обычный переход и вернул новую карточку. */
function patchPress(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId: string,
  result: PressExecuteResult,
) {
  markFreshFromMutation(taskId);
  queryClient.setQueryData(tasksKeys.detail(taskId), result.task);
  queryClient.setQueryData(tasksKeys.transitions(taskId), result.transitions);
  for (const key of [tasksKeys.listPages(), tasksKeys.kanbanAll()]) {
    void queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
  }
}

export function useSubmitPress(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PressSubmitBody) =>
      api<PressExecuteResult>(`/tasks/${taskId}/press/submit`, { method: 'POST', body }),
    onMutate: async (body) => {
      markFreshFromMutation(taskId);
      await queryClient.cancelQueries({ queryKey: tasksKeys.detail(taskId) });
      const previous = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
      if (previous?.press && previous.press.myEntry) {
        const press = previous.press;
        const entries = press.entries.map((entry) =>
          entry.userId === press.myEntry!.userId
            ? {
                ...entry,
                state: 'pressed' as const,
                pressedAt: new Date().toISOString(),
                result: pressEntryResultOf(body),
              }
            : entry,
        );
        queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), {
          ...previous,
          press: {
            ...press,
            entries,
            myEntry: entries.find((entry) => entry.userId === press.myEntry!.userId) ?? null,
            pressed: press.pressed + 1,
            canSubmit: false,
            canWithdraw: true,
          },
        });
      }
      return { previous };
    },
    onSuccess: (result) => {
      patchPress(queryClient, taskId, result);
      toast.success(ui.tasks.press.saved);
    },
    onError: (error, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tasksKeys.detail(taskId), context.previous);
      }
      toast.error(transitionErrorText(error));
    },
  });
}

export function useWithdrawPress(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<PressExecuteResult>(`/tasks/${taskId}/press/withdraw`, { method: 'POST' }),
    onSuccess: (result) => patchPress(queryClient, taskId, result),
    onError: (error) => toast.error(transitionErrorText(error)),
  });
}
