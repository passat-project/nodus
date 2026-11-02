import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type {
  BatchCreateProjectNodesBody,
  BatchCreateProjectNodesResponse,
  CreateProjectNodeBody,
  MoveProjectNodeBody,
  Paginated,
  ProjectNode,
  ProjectStructureResponse,
  TaskBulkResult,
  TaskListItem,
  UpdateProjectNodeBody,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../../shared/api-client.js';
import { toastApiError } from '../../../../shared/api/error-toast.js';
import { projectsKeys } from '../../../../shared/api/projects-list.js';
import { mapTaskInPages, tasksKeys } from '../../../../shared/api/tasks-keys.js';
import { applyNodeMove } from '../lib/structure-tree.js';

export { useProjectStructure } from '../../../../shared/api/project-structure.js';

/** Ключи кэша структуры (#467): под префиксом `projects` — инвалидации
 *  модуля достают и дерево, и справочник видов уровней. */
export const structureKeys = {
  of: (projectId: string) => projectsKeys.structure(projectId),
  nodeKinds: () => [...projectsKeys.all, 'node-kinds'] as const,
};

type QueryClient = ReturnType<typeof useQueryClient>;

function patchStructure(
  queryClient: QueryClient,
  projectId: string,
  update: (data: ProjectStructureResponse) => ProjectStructureResponse,
): void {
  queryClient.setQueryData<ProjectStructureResponse>(structureKeys.of(projectId), (data) =>
    data ? update(data) : data,
  );
}

function snapshotOf(queryClient: QueryClient, projectId: string) {
  return queryClient.getQueryData<ProjectStructureResponse>(structureKeys.of(projectId)) ?? null;
}

function rollback(
  queryClient: QueryClient,
  projectId: string,
  snapshot: ProjectStructureResponse | null,
) {
  if (snapshot) queryClient.setQueryData(structureKeys.of(projectId), snapshot);
}

const zeroRollup = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
} as const;

/** Создание узла: оптимистично с времёнкой (нулевой rollup досчитает
 *  сервер), откат снапшотом при отказе. */
export function useCreateNode(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectNodeBody) =>
      api<ProjectNode>(`/projects/${projectId}/nodes`, { method: 'POST', body }),
    onMutate: async (body) => {
      const snapshot = snapshotOf(queryClient, projectId);
      const tempId = `temp-${crypto.randomUUID()}`;
      patchStructure(queryClient, projectId, (data) => ({
        ...data,
        nodes: [
          ...data.nodes,
          {
            id: tempId,
            parentId: body.parentId ?? null,
            kindId: body.kindId,
            name: body.name,
            code: body.code ?? null,
            rollup: { ...zeroRollup },
            createdAt: new Date().toISOString(),
          },
        ],
      }));
      return { snapshot, tempId };
    },
    onError: (error, _body, context) => {
      rollback(queryClient, projectId, context?.snapshot ?? null);
      toastApiError(error);
    },
    onSuccess: (node, _body, context) => {
      patchStructure(queryClient, projectId, (data) => ({
        ...data,
        nodes: data.nodes.map((entry) => (entry.id === context?.tempId ? node : entry)),
      }));
      toast.success(ui.projects.savedDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: structureKeys.of(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(projectId) });
    },
  });
}

/** Пакетное создание («Здания: поз. 1–3»): имена собирает клиент. */
export function useBatchCreateNodes(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BatchCreateProjectNodesBody) =>
      api<BatchCreateProjectNodesResponse>(`/projects/${projectId}/nodes/batch`, {
        method: 'POST',
        body,
      }),
    onMutate: async (body) => {
      const snapshot = snapshotOf(queryClient, projectId);
      const prefix = `temp-${crypto.randomUUID()}`;
      patchStructure(queryClient, projectId, (data) => ({
        ...data,
        nodes: [
          ...data.nodes,
          ...body.names.map((name, index) => ({
            id: `${prefix}-${index}`,
            parentId: body.parentId ?? null,
            kindId: body.kindId,
            name,
            code: null,
            rollup: { ...zeroRollup },
            createdAt: new Date().toISOString(),
          })),
        ],
      }));
      return { snapshot, prefix, count: body.names.length };
    },
    onError: (error, _body, context) => {
      rollback(queryClient, projectId, context?.snapshot ?? null);
      toastApiError(error);
    },
    onSuccess: (response, _body, context) => {
      const tempIds = new Set(
        Array.from({ length: context?.count ?? 0 }, (_, index) => `${context?.prefix}-${index}`),
      );
      patchStructure(queryClient, projectId, (data) => ({
        ...data,
        nodes: [...data.nodes.filter((entry) => !tempIds.has(entry.id)), ...response.nodes],
      }));
      toast.success(ui.projects.savedDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: structureKeys.of(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(projectId) });
    },
  });
}

/** Правка узла: имя/код/вид-ярлык (порядок и родитель — move). */
export function useUpdateNode(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { nodeId: string } & UpdateProjectNodeBody) => {
      const { nodeId, ...body } = vars;
      return api<ProjectNode>(`/projects/${projectId}/nodes/${nodeId}`, {
        method: 'PATCH',
        body,
      });
    },
    onMutate: async (vars) => {
      const snapshot = snapshotOf(queryClient, projectId);
      patchStructure(queryClient, projectId, (data) => ({
        ...data,
        nodes: data.nodes.map((node) =>
          node.id === vars.nodeId
            ? {
                ...node,
                ...(vars.name !== undefined ? { name: vars.name } : {}),
                ...(vars.code !== undefined ? { code: vars.code } : {}),
                ...(vars.kindId !== undefined ? { kindId: vars.kindId } : {}),
              }
            : node,
        ),
      }));
      return { snapshot };
    },
    onError: (error, _vars, context) => {
      rollback(queryClient, projectId, context?.snapshot ?? null);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.savedDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: structureKeys.of(projectId) });
    },
  });
}

/** Перенос узла (DnD/меню): родитель + позиция среди детей; оптимистичный
 *  reorder кэша по тем же правилам, что сервер (applyNodeMove). */
export function useMoveNode(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { nodeId: string } & MoveProjectNodeBody) => {
      const { nodeId, ...body } = vars;
      return api<ProjectNode>(`/projects/${projectId}/nodes/${nodeId}/move`, {
        method: 'POST',
        body,
      });
    },
    onMutate: async (vars) => {
      const snapshot = snapshotOf(queryClient, projectId);
      patchStructure(queryClient, projectId, (data) => ({
        ...data,
        nodes: applyNodeMove(
          data.nodes,
          vars.nodeId,
          vars.parentId,
          vars.beforeId !== undefined || vars.afterId !== undefined
            ? { beforeId: vars.beforeId ?? undefined, afterId: vars.afterId ?? undefined }
            : {},
        ),
      }));
      return { snapshot };
    },
    onError: (error, _vars, context) => {
      rollback(queryClient, projectId, context?.snapshot ?? null);
      toastApiError(error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: structureKeys.of(projectId) });
    },
  });
}

/** Удаление ПУСТОГО узла (непустой — 409 от сервера, тост по коду ошибки). */
export function useDeleteNode(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) =>
      api<void>(`/projects/${projectId}/nodes/${nodeId}`, { method: 'DELETE' }),
    onMutate: async (nodeId) => {
      const snapshot = snapshotOf(queryClient, projectId);
      patchStructure(queryClient, projectId, (data) => ({
        ...data,
        nodes: data.nodes.filter((node) => node.id !== nodeId),
      }));
      return { snapshot };
    },
    onError: (error, _nodeId, context) => {
      rollback(queryClient, projectId, context?.snapshot ?? null);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.savedDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: structureKeys.of(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(projectId) });
    },
  });
}

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
