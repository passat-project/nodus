import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NodeKind, NodeKindCreateBody, NodeKindUpdateBody } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../../shared/api-client.js';
import { toastApiError } from '../../../../shared/api/error-toast.js';
import { projectsKeys } from '../../../../shared/api/projects-list.js';
import { structureKeys } from './structure-api.js';

/** Справочник видов узлов (#467): ярлыки узлов (значок + цвет), живёт в
 *  карточке проекта («Структура» → «Виды узлов»). Архив — не удаление: узлы
 *  архивного вида живут, новые создавать нельзя. Сервер отдаёт все виды
 *  сразу (архивные — с `archivedAt`), параметра фильтра нет. */

type QueryClient = ReturnType<typeof useQueryClient>;
const kindsPrefix = [...projectsKeys.all, 'node-kinds'] as const;

export function useNodeKinds() {
  return useQuery({
    queryKey: structureKeys.nodeKinds(),
    queryFn: () => api<NodeKind[]>('/projects/node-kinds'),
  });
}

function patchKinds(queryClient: QueryClient, update: (kinds: NodeKind[]) => NodeKind[]) {
  queryClient.setQueriesData<NodeKind[]>({ queryKey: kindsPrefix }, (data) =>
    data ? update(data) : data,
  );
}

function kindsSnapshot(queryClient: QueryClient) {
  return queryClient.getQueriesData<NodeKind[]>({ queryKey: kindsPrefix });
}

function restore(queryClient: QueryClient, snapshot: ReturnType<typeof kindsSnapshot>) {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

function invalidateKinds(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: kindsPrefix });
  // Виды уровней вшиты в ответ структуры — дерево перекрасится тоже.
  void queryClient.invalidateQueries({ queryKey: [...projectsKeys.all, 'structure'] });
}

export function useCreateNodeKind() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: NodeKindCreateBody) =>
      api<NodeKind>('/projects/node-kinds', { method: 'POST', body }),
    onMutate: async (body) => {
      const snapshot = kindsSnapshot(queryClient);
      const temp: NodeKind = { id: `temp-${crypto.randomUUID()}`, archivedAt: null, ...body };
      patchKinds(queryClient, (kinds) => [...kinds, temp]);
      return { snapshot, tempId: temp.id };
    },
    onError: (error, _body, context) => {
      restore(queryClient, context?.snapshot ?? []);
      toastApiError(error);
    },
    onSuccess: (kind, _body, context) => {
      patchKinds(queryClient, (kinds) =>
        kinds.map((entry) => (entry.id === context?.tempId ? kind : entry)),
      );
      toast.success(ui.projects.savedDone);
    },
    onSettled: () => invalidateKinds(queryClient),
  });
}

export function useUpdateNodeKind() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } & NodeKindUpdateBody) => {
      const { id, ...body } = vars;
      return api<NodeKind>(`/projects/node-kinds/${id}`, { method: 'PATCH', body });
    },
    onMutate: async (vars) => {
      const snapshot = kindsSnapshot(queryClient);
      patchKinds(queryClient, (kinds) =>
        kinds.map((entry) =>
          entry.id === vars.id
            ? {
                ...entry,
                ...(vars.name !== undefined ? { name: vars.name } : {}),
                ...(vars.icon !== undefined ? { icon: vars.icon } : {}),
                ...(vars.color !== undefined ? { color: vars.color } : {}),
              }
            : entry,
        ),
      );
      return { snapshot };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.snapshot ?? []);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.savedDone),
    onSettled: () => invalidateKinds(queryClient),
  });
}

/** Архивация вида (возврата нет — как у системных справочников; новые узлы
 *  архивного вида создавать нельзя, существующие живут). */
export function useArchiveNodeKind() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<NodeKind>(`/projects/node-kinds/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      const snapshot = kindsSnapshot(queryClient);
      patchKinds(queryClient, (kinds) =>
        kinds.map((entry) =>
          entry.id === id ? { ...entry, archivedAt: new Date().toISOString() } : entry,
        ),
      );
      return { snapshot };
    },
    onError: (error, _id, context) => {
      restore(queryClient, context?.snapshot ?? []);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.savedDone),
    onSettled: () => invalidateKinds(queryClient),
  });
}
