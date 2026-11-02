import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PortalSettings,
  ProjectGroup,
  ProjectType,
  ProjectTypeUpdateBody,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
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

/** Новый тип проекта («Автоматизация» → «Типы проектов»). */
export function useCreateProjectType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<ProjectType>('/projects/types', { method: 'POST', body: { name } }),
    onMutate: async (name) => {
      const snapshot = queryClient.getQueriesData<ProjectType[]>({
        queryKey: [...projectsKeys.all, 'types'],
      });
      const temp: ProjectType = {
        id: `temp-${crypto.randomUUID()}`,
        name,
        icon: 'file-text',
        color: 'blue',
        codeField: 'optional',
        kindIds: null,
        archivedAt: null,
      };
      patchTypes(queryClient, (items) => [...items, temp]);
      return { snapshot, tempId: temp.id };
    },
    onError: (error, _name, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: (type, _name, context) => {
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

/** Правка типа проекта: имя, политика системного поля «Шифр», допустимые
 *  виды папок (#556). */
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
          ...(vars.codeField ? { codeField: vars.codeField } : {}),
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
                ...(vars.codeField ? { codeField: vars.codeField } : {}),
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

/** Настройки портала: дефолт видимости новых проектов (Р7). */
export function useUpdatePortalSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: PortalSettings) =>
      api<PortalSettings>('/settings/portal', { method: 'PUT', body: settings }),
    onMutate: async (settings) => {
      const previous = queryClient.getQueryData<PortalSettings>(projectsKeys.settings());
      queryClient.setQueryData(projectsKeys.settings(), settings);
      return { previous };
    },
    onError: (error, _settings, context) => {
      if (context?.previous) queryClient.setQueryData(projectsKeys.settings(), context.previous);
      toastApiError(error);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(projectsKeys.settings(), settings);
      toast.success(ui.projects.settingsSaved);
    },
  });
}
