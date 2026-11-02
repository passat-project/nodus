import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  NodeKind,
  NodeKindCreateBody,
  NodeKindUpdateBody,
  ProjectStructureResponse,
} from '@nodus/contracts';
import { DEFAULT_NODE_KIND_CONFIG, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../../shared/api-client.js';
import { toastApiError } from '../../../../shared/api/error-toast.js';
import { nodeKindsKeys } from '../../../../shared/api/node-kinds.js';
import { projectsKeys } from '../../../../shared/api/projects-list.js';
import { tasksKeys } from '../../../../shared/api/tasks-keys.js';

/**
 * Мутации видов папок (#556, Р17): оптимистично, откат снапшотом, settle —
 * инвалидация. Правка вида патчит и реестр (`nodeKindsKeys`), и `kinds`
 * в кэшах структур (дерево и окно создания видят новую форму сразу).
 */

type QueryClient = ReturnType<typeof useQueryClient>;

function patchKinds(queryClient: QueryClient, update: (kinds: NodeKind[]) => NodeKind[]): void {
  queryClient.setQueriesData<NodeKind[]>({ queryKey: nodeKindsKeys.all }, (data) =>
    data ? update(data) : data,
  );
  queryClient.setQueriesData<ProjectStructureResponse>(
    { queryKey: projectsKeys.structures() },
    (data) => (data ? { ...data, kinds: update(data.kinds) } : data),
  );
}

function snapshot(queryClient: QueryClient) {
  return {
    kinds: queryClient.getQueriesData<NodeKind[]>({ queryKey: nodeKindsKeys.all }),
    structures: queryClient.getQueriesData<ProjectStructureResponse>({
      queryKey: projectsKeys.structures(),
    }),
  };
}

function restore(queryClient: QueryClient, context: ReturnType<typeof snapshot> | undefined) {
  for (const [key, data] of context?.kinds ?? []) queryClient.setQueryData(key, data);
  for (const [key, data] of context?.structures ?? []) queryClient.setQueryData(key, data);
}

function invalidate(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: nodeKindsKeys.all });
  void queryClient.invalidateQueries({ queryKey: projectsKeys.structures() });
}

export function useCreateNodeKind() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: NodeKindCreateBody) =>
      api<NodeKind>('/projects/node-kinds', { method: 'POST', body }),
    onMutate: async (body) => {
      const context = snapshot(queryClient);
      const temp: NodeKind = {
        id: `temp-${crypto.randomUUID()}`,
        archivedAt: null,
        form: DEFAULT_NODE_KIND_CONFIG.form,
        capabilities: [],
        ...body,
      };
      patchKinds(queryClient, (kinds) => [...kinds, temp]);
      return { ...context, tempId: temp.id };
    },
    onError: (error, _body, context) => {
      restore(queryClient, context);
      toastApiError(error);
    },
    onSuccess: (kind, _body, context) => {
      patchKinds(queryClient, (kinds) =>
        kinds.map((entry) => (entry.id === context?.tempId ? kind : entry)),
      );
      toast.success(ui.projects.savedDone);
    },
    onSettled: () => invalidate(queryClient),
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
      const context = snapshot(queryClient);
      patchKinds(queryClient, (kinds) =>
        kinds.map((entry) =>
          entry.id === vars.id
            ? {
                ...entry,
                ...(vars.name !== undefined ? { name: vars.name } : {}),
                ...(vars.icon !== undefined ? { icon: vars.icon } : {}),
                ...(vars.color !== undefined ? { color: vars.color } : {}),
                ...(vars.form !== undefined ? { form: vars.form } : {}),
                ...(vars.capabilities !== undefined ? { capabilities: vars.capabilities } : {}),
              }
            : entry,
        ),
      );
      return context;
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context);
      toastApiError(error);
    },
    onSettled: () => invalidate(queryClient),
  });
}

/** Архив и возврат: папки архивного вида живут, новые создавать нельзя. */
export function useArchiveNodeKind() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; archived: boolean }) =>
      vars.archived
        ? api<NodeKind>(`/projects/node-kinds/${vars.id}`, { method: 'DELETE' })
        : api<NodeKind>(`/projects/node-kinds/${vars.id}/restore`, { method: 'POST' }),
    onMutate: async (vars) => {
      const context = snapshot(queryClient);
      patchKinds(queryClient, (kinds) =>
        kinds.map((entry) =>
          entry.id === vars.id
            ? { ...entry, archivedAt: vars.archived ? new Date().toISOString() : null }
            : entry,
        ),
      );
      return context;
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.savedDone),
    onSettled: () => invalidate(queryClient),
  });
}

/** Инвалидация после отказа формы (422): устаревшая форма у клиента —
 *  перечитать виды и структуру (резерв Р10). */
export function useRefreshNodeKinds() {
  const queryClient = useQueryClient();
  return () => {
    invalidate(queryClient);
    void queryClient.invalidateQueries({ queryKey: tasksKeys.detailsAll() });
  };
}
