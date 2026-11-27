import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ProjectGroup,
  ProjectListItem,
  ProjectType,
  ProjectTypeCreateBody,
  ProjectTypeUpdateBody,
} from '@nodus/contracts';
import { DEFAULT_PROJECT_TYPE_FORM, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import {
  JOURNAL_PREFIX,
  stripPortfolioFromJournal,
  type JournalPages,
} from './project-mutation-helpers.js';

function patchTypes(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (items: ProjectType[]) => ProjectType[],
): void {
  queryClient.setQueriesData<ProjectType[]>({ queryKey: [...projectsKeys.all, 'types'] }, (data) =>
    data ? update(data) : data,
  );
}

/** Ключ списка портфелей. Счётчики папок (#559) живут под тем же префиксом
 *  `groups`, но другой формы — патчим только список. */
function groupListKeys() {
  return [projectsKeys.groups()] as const;
}

function patchGroups(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (items: ProjectGroup[]) => ProjectGroup[],
): void {
  for (const key of groupListKeys()) {
    queryClient.setQueryData<ProjectGroup[]>(key, (data) => (data ? update(data) : data));
  }
}

/** Снапшот списков портфелей — откат оптимистичной мутации. */
function snapshotGroups(
  queryClient: ReturnType<typeof useQueryClient>,
): (readonly [readonly unknown[], ProjectGroup[] | undefined])[] {
  return groupListKeys().map(
    (key) => [key, queryClient.getQueryData<ProjectGroup[]>(key)] as const,
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
/** `quiet` — без всплывающих уведомлений: для автосохранения вкладки «Форма
 *  создания» (#857), где состояние пишется тихой строкой в баре рамы. */
export function useUpdateProjectType({ quiet = false }: { quiet?: boolean } = {}) {
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
      if (!quiet) toastApiError(error);
    },
    onSuccess: () => {
      if (!quiet) toast.success(ui.projects.savedDone);
    },
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
      const snapshot = snapshotGroups(queryClient);
      const temp: ProjectGroup = { id: `temp-${crypto.randomUUID()}`, name };
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
      void queryClient.invalidateQueries({ queryKey: projectsKeys.groupsPrefix() });
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
      const snapshot = snapshotGroups(queryClient);
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
      void queryClient.invalidateQueries({ queryKey: projectsKeys.groupsPrefix() });
    },
  });
}

/**
 * Удаление портфеля НАВСЕГДА (#559): проекты не теряются — переходят в
 * «Без портфеля». Оптимистично убираем папку из кэша и снимаем её с проектов
 * журнала; при ошибке — откат снапшотом, затем перечитываем счётчики и
 * журналы (сервер — истина).
 */
export function useDeleteProjectGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/projects/groups/${id}/permanent`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: JOURNAL_PREFIX });
      const snapshot = snapshotGroups(queryClient);
      const journals = queryClient.getQueriesData<JournalPages>({ queryKey: JOURNAL_PREFIX });
      const options = queryClient.getQueriesData<{ items: ProjectListItem[] }>({
        queryKey: projectsKeys.options(),
      });
      patchGroups(queryClient, (items) => items.filter((row) => row.id !== id));
      stripPortfolioFromJournal(queryClient, id);
      return { snapshot, journals, options };
    },
    onError: (error, _id, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      for (const [key, data] of context?.journals ?? []) queryClient.setQueryData(key, data);
      for (const [key, data] of context?.options ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.portfolioDeletedDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
    },
  });
}
