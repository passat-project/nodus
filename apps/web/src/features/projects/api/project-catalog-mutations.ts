import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ProjectGroup,
  ProjectType,
  ProjectTypeCreateBody,
  ProjectTypeUpdateBody,
} from '@nodus/contracts';
import { DEFAULT_PROJECT_TYPE_FORM, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';

function patchTypes(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (items: ProjectType[]) => ProjectType[],
): void {
  queryClient.setQueriesData<ProjectType[]>({ queryKey: [...projectsKeys.all, 'types'] }, (data) =>
    data ? update(data) : data,
  );
}

function patchGroups(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (items: ProjectGroup[]) => ProjectGroup[],
): void {
  queryClient.setQueriesData<ProjectGroup[]>(
    { queryKey: [...projectsKeys.all, 'groups'] },
    (data) => (data ? update(data) : data),
  );
}

/** Новый тип проекта («Автоматизация» → «Схемы проектов»): название,
 *  значок и цвет — грамматика создания типа процесса. */
export function useCreateProjectType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectTypeCreateBody) =>
      api<ProjectType>('/projects/types', { method: 'POST', body }),
    onMutate: async (body) => {
      const snapshot = queryClient.getQueriesData<ProjectType[]>({
        queryKey: [...projectsKeys.all, 'types'],
      });
      const temp: ProjectType = {
        id: `temp-${crypto.randomUUID()}`,
        name: body.name,
        icon: body.icon ?? 'file-text',
        color: body.color ?? 'blue',
        form: body.form ?? DEFAULT_PROJECT_TYPE_FORM,
        kindIds: null,
        archivedAt: null,
      };
      patchTypes(queryClient, (items) => [...items, temp]);
      return { snapshot, tempId: temp.id };
    },
    onError: (error, _body, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: (type, _body, context) => {
      patchTypes(queryClient, (items) =>
        items.map((row) => (row.id === context.tempId ? type : row)),
      );
      toast.success(ui.projects.savedDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.types() });
    },
  });
}

/** Правка типа проекта: имя, значок, цвет, форма атрибутов (слоты, замена
 *  целиком — Р10 #631), допустимые виды папок (#556). */
export function useUpdateProjectType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } & ProjectTypeUpdateBody) =>
      api<ProjectType>(`/projects/types/${vars.id}`, {
        method: 'PATCH',
        body: {
          ...(vars.name ? { name: vars.name } : {}),
          ...(vars.icon ? { icon: vars.icon } : {}),
          ...(vars.color ? { color: vars.color } : {}),
          ...(vars.form !== undefined ? { form: vars.form } : {}),
          ...(vars.kindIds !== undefined ? { kindIds: vars.kindIds } : {}),
        },
      }),
    onMutate: async (vars) => {
      const snapshot = queryClient.getQueriesData<ProjectType[]>({
        queryKey: [...projectsKeys.all, 'types'],
      });
      patchTypes(queryClient, (items) =>
        items.map((row) =>
          row.id === vars.id
            ? {
                ...row,
                ...(vars.name ? { name: vars.name } : {}),
                ...(vars.icon ? { icon: vars.icon } : {}),
                ...(vars.color ? { color: vars.color } : {}),
                ...(vars.form !== undefined ? { form: vars.form } : {}),
                ...(vars.kindIds !== undefined ? { kindIds: vars.kindIds } : {}),
              }
            : row,
        ),
      );
      return { snapshot };
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.savedDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.types() });
    },
  });
}

/** Архив/возврат типа (проекты сохраняют ссылку, состав не ломается). */
export function useSetProjectTypeArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api<ProjectType>(`/projects/types/${id}${archived ? '' : '/restore'}`, {
        method: archived ? 'DELETE' : 'POST',
      }),
    onMutate: async ({ id, archived }) => {
      const snapshot = queryClient.getQueriesData<ProjectType[]>({
        queryKey: [...projectsKeys.all, 'types'],
      });
      patchTypes(queryClient, (items) =>
        items.map((row) =>
          row.id === id ? { ...row, archivedAt: archived ? new Date().toISOString() : null } : row,
        ),
      );
      return { snapshot };
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.savedDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.types() });
    },
  });
}

/** Новый портфель (плоский список группировки проектов). */
export function useCreateProjectGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<ProjectGroup>('/projects/groups', { method: 'POST', body: { name } }),
    onMutate: async (name) => {
      const snapshot = queryClient.getQueriesData<ProjectGroup[]>({
        queryKey: [...projectsKeys.all, 'groups'],
      });
      const temp: ProjectGroup = { id: `temp-${crypto.randomUUID()}`, name, archivedAt: null };
      patchGroups(queryClient, (items) => [...items, temp]);
      return { snapshot, tempId: temp.id };
    },
    onError: (error, _name, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: (group, _name, context) => {
      patchGroups(queryClient, (items) =>
        items.map((row) => (row.id === context.tempId ? group : row)),
      );
      toast.success(ui.projects.savedDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.groups() });
    },
  });
}

/** Переименование портфеля. */
export function useRenameProjectGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; name: string }) =>
      api<ProjectGroup>(`/projects/groups/${vars.id}`, {
        method: 'PATCH',
        body: { name: vars.name },
      }),
    onMutate: async ({ id, name }) => {
      const snapshot = queryClient.getQueriesData<ProjectGroup[]>({
        queryKey: [...projectsKeys.all, 'groups'],
      });
      patchGroups(queryClient, (items) =>
        items.map((row) => (row.id === id ? { ...row, name } : row)),
      );
      return { snapshot };
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.savedDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.groups() });
    },
  });
}

/** Архив портфеля (проекты сохраняются без него). */
export function useArchiveProjectGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<ProjectGroup>(`/projects/groups/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      const snapshot = queryClient.getQueriesData<ProjectGroup[]>({
        queryKey: [...projectsKeys.all, 'groups'],
      });
      patchGroups(queryClient, (items) =>
        items.map((row) =>
          row.id === id ? { ...row, archivedAt: new Date().toISOString() } : row,
        ),
      );
      return { snapshot };
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.savedDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.groups() });
    },
  });
}
