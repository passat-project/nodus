import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PressExcludeBody,
  PressExecuteResult,
  PressReturnBody,
  PressSubmitBody,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { markFreshFromMutation } from '../../../shared/api/fresh-from-mutation.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { transitionErrorText } from '../../../shared/tasks/transition-error.js';

/** Коллективная кнопка (#434): сдача и отзыв своей отметки. Сдача —
 *  ПЕССИМИСТИЧНАЯ, как окно перехода (#380, Р7): кольцо и счётчик меняются
 *  ответом сервера; оптимистичная правка потеряла бы ввод при отказе.
 *  Один `Idempotency-Key` на попытку (ref): повтор после обрыва сети не
 *  задвоит время, итог и строку журнала. */
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
  const idempotencyKey = useRef<string | null>(null);
  return useMutation({
    mutationFn: (body: PressSubmitBody) => {
      idempotencyKey.current ??= crypto.randomUUID();
      return api<PressExecuteResult>(`/tasks/${taskId}/press/submit`, {
        method: 'POST',
        body,
        idempotencyKey: idempotencyKey.current,
      });
    },
    onSuccess: (result) => {
      idempotencyKey.current = null;
      patchPress(queryClient, taskId, result);
      toast.success(ui.tasks.press.saved);
    },
    onError: (error) => {
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

/** Выборочный возврат (#434): ответственный возвращает результаты выбранным,
 *  остальные остаются сданными. После ответа карточка и кнопки пересчитаны. */
export function useReturnPress(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PressReturnBody) =>
      api<PressExecuteResult>(`/tasks/${taskId}/press/return`, { method: 'POST', body }),
    onSuccess: (result) => {
      patchPress(queryClient, taskId, result);
      toast.success(ui.tasks.press.returnedToast);
    },
    onError: (error) => toast.error(transitionErrorText(error)),
  });
}

/** Снятие с открытого сбора (#434): уволенный/выбывший не держит кворум. */
export function useExcludePress(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PressExcludeBody) =>
      api<PressExecuteResult>(`/tasks/${taskId}/press/exclude`, { method: 'POST', body }),
    onSuccess: (result) => {
      patchPress(queryClient, taskId, result);
      toast.success(ui.tasks.press.excludedToast);
    },
    onError: (error) => toast.error(transitionErrorText(error)),
  });
}
