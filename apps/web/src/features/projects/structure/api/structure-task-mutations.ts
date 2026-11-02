import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { Paginated, TaskBulkResult, TaskListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../../shared/api-client.js';
import { toastApiError } from '../../../../shared/api/error-toast.js';
import { projectsKeys } from '../../../../shared/api/projects-list.js';
import { mapTaskInPages, tasksKeys } from '../../../../shared/api/tasks-keys.js';
import { structureKeys } from './structure-api.js';

/** Переносы задач в папки структуры (#467): одиночный DnD — PATCH задачи,
 *  мультиселект — bulk set_node. Вынесено из structure-api (I5). */

/** Одиночный перенос задачи в узел — PATCH /tasks/:id (контракт
 *  `taskUpdateBodySchema.nodeId`). Bulk set_node остаётся для мультиселекта:
 *  одиночный DnD не должен ходить массовой операцией (#467). */
export function useMoveTaskNode(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { taskId: string; nodeId: string | null }) =>
      api<TaskListItem>(`/tasks/${vars.taskId}`, {
        method: 'PATCH',
        body: { nodeId: vars.nodeId },
      }),
    onMutate: async (vars) => {
      const snapshots = queryClient.getQueriesData({
        queryKey: tasksKeys.listPages(),
      });
      for (const [key] of snapshots) {
        queryClient.setQueryData(key, (data) =>
          mapTaskInPages(data as Parameters<typeof mapTaskInPages>[0], vars.taskId, (task) => ({
            ...task,
            nodeId: vars.nodeId,
          })),
        );
      }
      return { snapshots };
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
      void queryClient.invalidateQueries({ queryKey: structureKeys.of(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(projectId) });
    },
  });
}

/** Массовый перенос задач в узел / «Без узла» (мультиселект): bulk set_node.
 *  Одиночный перенос идёт PATCH-ем (`useMoveTaskNode`), bulk — только для
 *  пачки (#467). Оптимистично патчит страницы фида задач; агрегаты узлов
 *  пересчитает сервер. */
export function useSetTasksNode(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { taskIds: string[]; nodeId: string | null }) =>
      api<TaskBulkResult>('/tasks/bulk', {
        method: 'POST',
        body: { taskIds: vars.taskIds, action: { kind: 'set_node', nodeId: vars.nodeId } },
      }),
    onMutate: async (vars) => {
      const snapshots = queryClient.getQueriesData({
        queryKey: tasksKeys.listPages(),
      }) as [readonly unknown[], InfiniteData<Paginated<TaskListItem>> | undefined][];
      const ids = new Set(vars.taskIds);
      for (const [key] of snapshots) {
        queryClient.setQueryData<InfiniteData<Paginated<TaskListItem>>>(key, (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.map((task) =>
                    ids.has(task.id) ? { ...task, nodeId: vars.nodeId } : task,
                  ),
                })),
              }
            : data,
        );
      }
      return { snapshots };
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: ({ results }) => {
      const ok = results.filter((r) => r.ok).length;
      if (ok > 0) toast.success(ui.structure.movedTasks);
      const failed = results.length - ok;
      if (failed > 0) toast.error(`${ui.tasks.bulkSkipped} ${failed}`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
      void queryClient.invalidateQueries({ queryKey: structureKeys.of(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(projectId) });
    },
  });
}
