import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  BatchCreateProjectNodesBody,
  BatchCreateProjectNodesResponse,
  CreateProjectNodeBody,
  CustomFieldRef,
  CustomFieldValue,
  MoveProjectNodeBody,
  ProjectNode,
  ProjectStructureResponse,
  UpdateProjectNodeBody,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../../shared/api-client.js';
import { toastApiError } from '../../../../shared/api/error-toast.js';
import { projectsKeys } from '../../../../shared/api/projects-list.js';
import { withEmptyNumberConfirm } from '../../../../shared/custom-fields/number-confirm.js';
import { applyNodeMove } from '../lib/structure-tree.js';

export { useProjectStructure } from '../../../../shared/api/project-structure.js';

/** Ключи кэша структуры (#467): под префиксом `projects` — инвалидации
 *  модуля достают дерево. Виды папок — `nodeKindsKeys` (shared/api). */
export const structureKeys = {
  of: (projectId: string) => projectsKeys.structure(projectId),
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

/** Слияние патча значений: `null` удаляет ключ (канон JSONB-значений). */
function mergeValues(
  current: Record<string, CustomFieldValue>,
  patch: Record<string, CustomFieldValue | null>,
): Record<string, CustomFieldValue> {
  const next = { ...current };
  for (const [fieldId, value] of Object.entries(patch)) {
    if (value === null) delete next[fieldId];
    else next[fieldId] = value;
  }
  return next;
}

/** Ссылки выбора — дедуп по `kind:id`, свежие поверх старых. */
function mergeRefs(current: readonly CustomFieldRef[], added: readonly CustomFieldRef[]) {
  const refs = new Map(current.map((ref) => [`${ref.kind}:${ref.id}`, ref]));
  for (const ref of added) refs.set(`${ref.kind}:${ref.id}`, ref);
  return [...refs.values()];
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
    // Номер «при создании» с пустым полем (#630) — окно и повтор.
    mutationFn: (body: CreateProjectNodeBody) =>
      withEmptyNumberConfirm((confirmed) =>
        api<ProjectNode>(`/projects/${projectId}/nodes`, {
          method: 'POST',
          body: confirmed ? { ...body, confirmEmptyNumberParts: true } : body,
        }),
      ),
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
            customFields: body.customFields ?? {},
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
      withEmptyNumberConfirm((confirmed) =>
        api<BatchCreateProjectNodesResponse>(`/projects/${projectId}/nodes/batch`, {
          method: 'POST',
          body: confirmed ? { ...body, confirmEmptyNumberParts: true } : body,
        }),
      ),
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
            customFields: body.customFields ?? {},
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

/** Правка папки: имя/шифр/вид/значения (порядок и родитель — move).
 *  Оптимистично: значения сливаются (`null` удаляет ключ), ссылки выбора
 *  дописываются в `customFieldRefs` — имя марки видно до ответа (I4, Р17). */
export function useUpdateNode(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      vars: { nodeId: string } & UpdateProjectNodeBody & { refs?: CustomFieldRef[] },
    ) => {
      const { nodeId, refs, ...body } = vars;
      // refs нужны только оптимистичному кэшу (onMutate), в тело не уходят.
      void refs;
      // Смена вида на вид с номером «при создании» (#630) выдаёт номер —
      // пустое поле в номере: окно и повтор с подтверждением.
      return withEmptyNumberConfirm((confirmed) =>
        api<ProjectNode>(`/projects/${projectId}/nodes/${nodeId}`, {
          method: 'PATCH',
          body: confirmed ? { ...body, confirmEmptyNumberParts: true } : body,
        }),
      );
    },
    onMutate: async (vars) => {
      const snapshot = snapshotOf(queryClient, projectId);
      patchStructure(queryClient, projectId, (data) => {
        const refs = mergeRefs(data.customFieldRefs, vars.refs ?? []);
        return {
          ...data,
          customFieldRefs: refs,
          nodes: data.nodes.map((node) =>
            node.id === vars.nodeId
              ? {
                  ...node,
                  ...(vars.name !== undefined ? { name: vars.name } : {}),
                  ...(vars.code !== undefined ? { code: vars.code } : {}),
                  ...(vars.kindId !== undefined ? { kindId: vars.kindId } : {}),
                  ...(vars.customFields !== undefined
                    ? { customFields: mergeValues(node.customFields, vars.customFields) }
                    : {}),
                }
              : node,
          ),
        };
      });
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
