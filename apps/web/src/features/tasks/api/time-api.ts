import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Paginated,
  RunningTimer,
  TaskDetail,
  TimeEntry,
  TimeEntryCreateBody,
} from '@nodus/contracts';
import { errorMessages, ui, type ErrorCode } from '@nodus/contracts';
import { toast } from 'sonner';

import { api, ApiError } from '../../../shared/api-client.js';
import { invalidateAfterTaskMutation } from '../../../shared/api/task-invalidate.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';

/** Учёт времени (I14): записи задачи, ручной ввод и таймер. Таймер у
 *  сотрудника один — запуск на другой задаче останавливает прежний. */

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const known = errorMessages[error.code as ErrorCode];
    if (known) return known;
  }
  return ui.common.saveError;
}

function useSettleTime() {
  const queryClient = useQueryClient();
  return (taskId: string | undefined) => {
    void queryClient.invalidateQueries({ queryKey: tasksKeys.timer() });
    if (!taskId) return;
    void queryClient.invalidateQueries({ queryKey: tasksKeys.timeEntries(taskId) });
    // spentMinutes — в детали, гейт time_logged — в переходах, часы — в
    // агрегатах узлов; доски и журнал догоняет эхо task.time_* (#1051).
    invalidateAfterTaskMutation(queryClient, taskId, { structure: true });
  };
}

export function useTimeEntries(taskId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: tasksKeys.timeEntries(taskId),
    queryFn: ({ pageParam }) =>
      api<Paginated<TimeEntry>>(
        // #1032: страницы по курсору — «Затрачено» не обрезается на 100 записях.
        `/tasks/${taskId}/time-entries?limit=100${
          pageParam === null ? '' : `&cursor=${encodeURIComponent(pageParam)}`
        }`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useAddTimeEntry(taskId: string) {
  const settle = useSettleTime();
  return useMutation({
    mutationFn: (body: TimeEntryCreateBody) =>
      api<TimeEntry>(`/tasks/${taskId}/time-entries`, { method: 'POST', body }),
    onSuccess: () => toast.success(ui.tasks.timeLogged),
    onError: (error) => toast.error(errorText(error)),
    onSettled: () => settle(taskId),
  });
}

export function useDeleteTimeEntry(taskId: string) {
  const settle = useSettleTime();
  return useMutation({
    mutationFn: (entryId: string) =>
      api<void>(`/tasks/time-entries/${entryId}`, { method: 'DELETE' }),
    onError: (error) => toast.error(errorText(error)),
    onSettled: () => settle(taskId),
  });
}

/** Идущий таймер текущего пользователя (null — не идёт). */
export function useRunningTimer() {
  return useQuery({
    queryKey: tasksKeys.timer(),
    queryFn: () => api<RunningTimer | null>('/tasks/timer'),
    staleTime: 30_000,
    // Модуль задач может быть выключен флагом (404) — без повторов в топбаре.
    retry: false,
  });
}

export function useStartTimer(taskId: string) {
  const queryClient = useQueryClient();
  const settle = useSettleTime();
  return useMutation({
    mutationFn: () => api<RunningTimer>(`/tasks/${taskId}/timer/start`, { method: 'POST' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: tasksKeys.timer() });
      const previous = queryClient.getQueryData<RunningTimer | null>(tasksKeys.timer()) ?? null;
      // Оптимистичный старт: кнопка/чип раскрываются с клика, без ожидания
      // ответа; ошибка откатывает к previous. Деталь задачи в кэше есть
      // всегда — кнопка живёт на её карточке; нет — ждём сервер как раньше.
      const detail = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
      if (detail) {
        queryClient.setQueryData(tasksKeys.timer(), {
          // entryId синтетический до ответа сервера — сейчас его никто не читает.
          entryId: crypto.randomUUID(),
          task: { id: detail.id, number: detail.number, title: detail.title },
          startedAt: new Date().toISOString(),
        });
      }
      return previous;
    },
    onSuccess: (timer, _vars, previous) => {
      queryClient.setQueryData(tasksKeys.timer(), timer);
      // Таймер один на сотрудника: прежний остановлен — его минуты записаны.
      if (previous && previous.task.id !== taskId) {
        toast.info(`${ui.tasks.timerSwitched}${previous.task.number}`);
        settle(previous.task.id);
      }
    },
    onError: (error, _vars, previous) => {
      queryClient.setQueryData(tasksKeys.timer(), previous);
      toast.error(errorText(error));
    },
    onSettled: () => settle(taskId),
  });
}

export function useStopTimer() {
  const queryClient = useQueryClient();
  const settle = useSettleTime();
  return useMutation({
    mutationFn: () => api<void>('/tasks/timer/stop', { method: 'POST' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: tasksKeys.timer() });
      const previous = queryClient.getQueryData<RunningTimer | null>(tasksKeys.timer()) ?? null;
      queryClient.setQueryData(tasksKeys.timer(), null);
      return previous;
    },
    onError: (error, _vars, previous) => {
      queryClient.setQueryData(tasksKeys.timer(), previous);
      toast.error(errorText(error));
    },
    onSettled: (_data, _error, _vars, previous) => settle(previous?.task.id),
  });
}
