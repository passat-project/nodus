import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type {
  PersonalStageCreateBody,
  PersonalStageUpdateBody,
  TaskDetail,
  TaskListItem,
  TaskStage,
  Paginated,
} from '@nodus/contracts';
import { toast } from 'sonner';

import { transitionErrorText } from './transitions-api.js';

import { api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { mapTaskInPages, tasksKeys } from './tasks-api.js';

// usePersonalStages/useCreateTask — canonical в shared/api/task-create
// (общая экспресс-форма shared/tasks); реэкспорт для потребителей фичи.
export { useCreateTask, usePersonalStages } from '../../../shared/api/task-create.js';

/** Оптимистичный перенос по ЛИЧНОЙ оси «Мой план» (ADR-0008): глобальная
 *  стадия задачи не меняется; в кэшах — personalStageId до ответа сервера. */
export function useUpdateTaskPersonalStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      personalStageId,
      index,
    }: {
      taskId: string;
      personalStageId: string;
      index: number;
    }) =>
      api<TaskListItem>(`/tasks/${taskId}`, { method: 'PATCH', body: { personalStageId, index } }),

    onMutate: async ({ taskId, personalStageId }) => {
      await queryClient.cancelQueries({ queryKey: tasksKeys.listPages() });
      const previous = queryClient.getQueryData<InfiniteData<Paginated<TaskListItem>>>(
        tasksKeys.listPages(),
      );
      const previousDetail = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
      queryClient.setQueryData<InfiniteData<Paginated<TaskListItem>>>(
        tasksKeys.listPages(),
        (old) =>
          mapTaskInPages(old, taskId, (t) => ({
            ...t,
            personalStageId,
            updatedAt: new Date().toISOString(),
          })),
      );
      queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), (old) =>
        old ? { ...old, personalStageId, updatedAt: new Date().toISOString() } : old,
      );
      return { previous, previousDetail };
    },

    onError: (error, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tasksKeys.listPages(), context.previous);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(tasksKeys.detail(vars.taskId), context.previousDetail);
      }
      // Отказ маршрута/гейта — с причиной (ADR-0020), не безликое «вернули».
      toast.error(transitionErrorText(error));
    },

    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.listPages() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.kanbanAll() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.personalStages() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.detail(vars.taskId) });
    },
  });
}

/** Создание личной колонки (личная схема пользователя, ADR-0008). Ошибка —
 *  тостом по коду (#730): плитка создания стадии остаётся открытой с вводом. */
export function useCreatePersonalStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PersonalStageCreateBody) =>
      api<TaskStage>('/tasks/personal-stages', { method: 'POST', body }),
    onError: (error) => toastApiError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.personalStages() });
    },
  });
}

/** Переименование / цвет / состояние личной колонки. */
export function useUpdatePersonalStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ stageId, body }: { stageId: string; body: PersonalStageUpdateBody }) =>
      api<TaskStage>(`/tasks/personal-stages/${stageId}`, { method: 'PATCH', body }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.personalStages() });
    },
  });
}

/** Удаление личной колонки: единственную нельзя (409 TASK_LAST_STAGE);
 *  задачи удаляемой переезжают в первую колонку того же состояния. */
export function useDeletePersonalStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stageId: string) =>
      api<{ ok: boolean; movedToStageId: string }>(`/tasks/personal-stages/${stageId}`, {
        method: 'DELETE',
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.personalStages() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.kanbanAll() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.listPages() });
    },
  });
}
