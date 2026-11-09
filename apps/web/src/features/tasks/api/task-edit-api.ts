import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type {
  Paginated,
  TaskBulkBody,
  TaskBulkResult,
  TaskDetail,
  TaskListItem,
  TaskResult,
  TaskResultCreateBody,
  TaskUpdateBody,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { mapTaskInPages, taskDependentKeys, tasksKeys } from '../../../shared/api/tasks-keys.js';
import { fieldLockedText } from '../../../shared/forms/field-lock-ui.js';

/** Правка полей карточки — подмножество PATCH без переноса по осям. */
export type TaskFieldsPatch = Partial<
  Pick<TaskUpdateBody, 'title' | 'description' | 'priority' | 'deadline' | 'plannedMinutes'>
> & {
  /** Причина правки закреплённого поля (#496): сервер требует 3..500. */
  lockReason?: string;
};

/** Правка полей задачи (I4): значение в карточке и журнале меняется сразу,
 *  откат по снапшоту; после ответа — переходы (гейты читают поля), доски и
 *  счётчики просрочки пересобираются инвалидацией.
 *  Канон patterns.md: cancel → снапшот ВСЕХ патчимых кэшей → патч → откат
 *  всех. Журналов несколько (префикс listPages: «мои», «все доступные»,
 *  задачи проекта) — строка задачи патчится в каждом подгруженном; без
 *  cancel летящий рефеч журнала затирал бы оптимистичное значение старым. */
export function useUpdateTask(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: TaskFieldsPatch) =>
      api<TaskListItem>(`/tasks/${taskId}`, { method: 'PATCH', body: patch }),
    onMutate: async (patch) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: tasksKeys.detail(taskId) }),
        queryClient.cancelQueries({ queryKey: tasksKeys.listPages() }),
      ]);
      const previous = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
      const previousPages = queryClient.getQueriesData<InfiniteData<Paginated<TaskListItem>>>({
        queryKey: tasksKeys.listPages(),
      });
      if (previous)
        queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), { ...previous, ...patch });
      const row = listPatch(patch);
      queryClient.setQueriesData<InfiniteData<Paginated<TaskListItem>>>(
        { queryKey: tasksKeys.listPages() },
        (old) => mapTaskInPages(old, taskId, (t) => ({ ...t, ...row })),
      );
      return { previous, previousPages };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(tasksKeys.detail(taskId), context.previous);
      for (const [key, data] of context?.previousPages ?? []) {
        queryClient.setQueryData(key, data);
      }
      toast.error(fieldLockedText(error) ?? ui.common.saveError);
    },
    onSettled: () => {
      for (const key of taskDependentKeys(taskId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** Поля, которые есть и у строки журнала (описания/плана там нет). */
function listPatch(patch: TaskFieldsPatch): Partial<TaskListItem> {
  const out: Partial<TaskListItem> = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.priority !== undefined) out.priority = patch.priority;
  if (patch.deadline !== undefined) out.deadline = patch.deadline;
  return out;
}

/** Каскад срока родителя (#311): подзадачи сдвигаются на тот же интервал —
 *  у каждой свой срок, поэтому не bulk «один срок всем», а PATCH на каждую;
 *  права проверяет сервер по каждой (чужую подзадачу не сдвинет). */
export function useShiftSubtaskDeadlines() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: { id: string; deadline: string }[]) => {
      const results = await Promise.allSettled(
        items.map((s) =>
          api<TaskListItem>(`/tasks/${s.id}`, { method: 'PATCH', body: { deadline: s.deadline } }),
        ),
      );
      return results.filter((r) => r.status === 'fulfilled').length;
    },
    onSuccess: (ok, items) => {
      if (ok === items.length) toast.success(ui.tasks.cascadeDone);
      else toast.error(`${ui.tasks.bulkSkipped} ${items.length - ok}`);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: tasksKeys.all }),
  });
}

/** Новая ревизия результата (append-only; текущий — последняя). */
export function useSaveTaskResult(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskResultCreateBody) =>
      api<TaskResult>(`/tasks/${taskId}/results`, { method: 'POST', body }),
    onSuccess: (result) => {
      queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), (old) =>
        old ? { ...old, result } : old,
      );
      toast.success(ui.tasks.resultSaved);
    },
    onError: () => toast.error(ui.common.saveError),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.detail(taskId) });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.transitions(taskId) });
    },
  });
}

/** Массовая операция журнала (до 100 задач): ответ — по каждой задаче,
 *  частичный успех — норма (права и гейты индивидуальны). */
export function useBulkTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskBulkBody) =>
      api<TaskBulkResult>('/tasks/bulk', { method: 'POST', body }),
    onSuccess: ({ results }) => {
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      if (ok > 0) toast.success(`${ui.tasks.bulkDone} ${ok} ${ui.common.of} ${results.length}`);
      if (failed > 0) toast.error(`${ui.tasks.bulkSkipped} ${failed}`);
    },
    onError: () => toast.error(ui.common.saveError),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
    },
  });
}

/** Удаление задачи (постановщик или task.manage_any; мягкое — подзадачи
 *  поднимаются к деду, чат задачи распускается, уведомления чистятся). */
export function useDeleteTask(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: tasksKeys.detail(taskId) });
      toast.success(ui.tasks.deleted);
    },
    onError: () => toast.error(ui.common.saveError),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
    },
  });
}
