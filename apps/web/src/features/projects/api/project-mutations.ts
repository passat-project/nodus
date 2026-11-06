import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CounterpartyRef,
  CreateProjectBody,
  ProjectDetail,
  ProjectGroup,
  ProjectListItem,
  ProjectStatus,
  ProjectType,
  UpdateProjectBody,
  UserRef,
} from '@nodus/contracts';
import { SYSTEM_FIELD_IDS, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { matchesProjectFilters, type ProjectJournalFilters } from '../lib/project-journal.js';
import {
  JOURNAL_PREFIX,
  cachedUsers,
  replaceInJournal,
  userRefOf,
  type JournalPages,
} from './project-mutation-helpers.js';

/** Шифр из значений атрибутов (системное поле «Шифр», #631): строка или
 *  `null` — витринные поля строки журнала остаются производными. */
function codeOf(
  customFields: CreateProjectBody['customFields'] | UpdateProjectBody['customFields'],
): string | null {
  const value = customFields?.[SYSTEM_FIELD_IDS.projectCode];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Значения после патча (`null` удаляет ключ) — оптимистичный кэш карточки. */
function valuesPatched(
  current: ProjectDetail['customFields'],
  patch: NonNullable<UpdateProjectBody['customFields']>,
): ProjectDetail['customFields'] {
  const next = { ...current };
  for (const [fieldId, value] of Object.entries(patch)) {
    if (value === null) delete next[fieldId];
    else next[fieldId] = value;
  }
  return next;
}

/** Создание проекта: оптимистичная вставка в журналы, чьим фильтрам запись
 *  удовлетворяет (I4), серверный DTO заменяет временную строку на месте.
 *  `client` — витринная ссылка заказчика для строки журнала (значение едет
 *  в `customFields` по ключу системного поля, #631). */
export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { body: CreateProjectBody; client?: CounterpartyRef | null }) =>
      api<ProjectDetail>('/projects', { method: 'POST', body: vars.body }),
    onMutate: async ({ body, client }) => {
      await queryClient.cancelQueries({ queryKey: JOURNAL_PREFIX });
      const snapshot = queryClient.getQueriesData<JournalPages>({ queryKey: JOURNAL_PREFIX });
      const me = useAuthStore.getState().user;
      const users = cachedUsers(queryClient);
      const types = queryClient.getQueryData<ProjectType[]>(projectsKeys.types()) ?? [];
      const groups = queryClient.getQueryData<ProjectGroup[]>(projectsKeys.groups()) ?? [];
      const defaultVisibility =
        queryClient.getQueryData<{ projects: { defaultVisibility: 'open' | 'secret' } }>(
          projectsKeys.settings(),
        )?.projects.defaultVisibility ?? 'open';
      const managerId = body.managerId ?? me?.id ?? '';
      const assistantIds = [...new Set(body.assistantIds ?? [])].filter((id) => id !== managerId);
      const creatorObserver = managerId !== (me?.id ?? '');
      const people = [
        ...new Set([managerId, ...assistantIds, ...(creatorObserver && me ? [me.id] : [])]),
      ];
      const type = types.find((entry) => entry.id === body.typeId);
      const portfolio = groups.find((entry) => entry.id === body.portfolioId);
      const temp: ProjectListItem = {
        id: `temp-${crypto.randomUUID()}`,
        code: codeOf(body.customFields),
        name: body.name,
        color: body.color ?? 'blue',
        manager: managerId ? userRefOf(managerId, users) : null,
        assistants: assistantIds.map((id) => userRefOf(id, users)),
        myMembership: {
          manager: managerId === me?.id,
          assistant: assistantIds.includes(me?.id ?? ''),
          participant: false,
          observer: creatorObserver,
        },
        visibility: body.visibility ?? defaultVisibility,
        status: 'active',
        type: type ? { id: type.id, name: type.name } : null,
        portfolio: portfolio ? { id: portfolio.id, name: portfolio.name } : null,
        client: client ?? null,
        membersCount: people.length,
        membersPreview: people.map((id) => userRefOf(id, users)),
        endDate: body.endDate ?? null,
        activityAt: new Date().toISOString(),
      };
      for (const [key, data] of snapshot) {
        const filters = key[2] as ProjectJournalFilters;
        if (!data || !matchesProjectFilters(temp, filters)) continue;
        queryClient.setQueryData<JournalPages>(key, {
          ...data,
          pages: data.pages.map((page, index) =>
            index === 0 ? { ...page, items: [temp, ...page.items] } : page,
          ),
        });
      }
      return { snapshot, tempId: temp.id };
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
      toastApiError(error);
    },
    onSuccess: (project, _vars, context) => {
      const item: ProjectListItem = project;
      queryClient.setQueriesData<JournalPages>({ queryKey: JOURNAL_PREFIX }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.map((row) => (row.id === context.tempId ? item : row)),
              })),
            }
          : data,
      );
      queryClient.setQueryData(projectsKeys.detail(project.id), project);
      toast.success(ui.projects.createdDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
    },
  });
}

/** Правка полей: оптимистичный патч карточки и строк журнала (I4). Шифр и
 *  заказчик — атрибуты: их значения едут в `customFields` (ключи системных
 *  полей), `client` — витринная ссылка для строки журнала (в тело не идёт). */
export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { body: UpdateProjectBody; client?: CounterpartyRef | null }) =>
      api<ProjectDetail>(`/projects/${id}`, { method: 'PATCH', body: vars.body }),
    onMutate: async ({ body, client }) => {
      await queryClient.cancelQueries({ queryKey: projectsKeys.detail(id) });
      const previous = queryClient.getQueryData<ProjectDetail>(projectsKeys.detail(id));
      const users = cachedUsers(queryClient);
      const groups = queryClient.getQueryData<ProjectGroup[]>(projectsKeys.groups()) ?? [];
      const portfolio = groups.find((entry) => entry.id === body.portfolioId);
      const patch: Partial<ProjectListItem> = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.customFields && SYSTEM_FIELD_IDS.projectCode in body.customFields
          ? { code: codeOf(body.customFields) }
          : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate ?? null } : {}),
        ...(body.assistantIds !== undefined
          ? { assistants: [...new Set(body.assistantIds)].map((uid) => userRefOf(uid, users)) }
          : {}),
        ...(body.portfolioId !== undefined
          ? { portfolio: portfolio ? { id: portfolio.id, name: portfolio.name } : null }
          : {}),
        ...(client !== undefined ? { client } : {}),
      };
      replaceInJournal(queryClient, id, patch);
      if (previous) {
        queryClient.setQueryData<ProjectDetail>(projectsKeys.detail(id), {
          ...previous,
          ...patch,
          ...(body.description !== undefined ? { description: body.description ?? '' } : {}),
          ...(body.startDate !== undefined ? { startDate: body.startDate ?? null } : {}),
          ...(body.customFields
            ? { customFields: valuesPatched(previous.customFields, body.customFields) }
            : {}),
        });
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectsKeys.detail(id), context.previous);
      }
      toastApiError(error);
    },
    onSuccess: (project) => {
      queryClient.setQueryData(projectsKeys.detail(id), project);
      replaceInJournal(queryClient, id, project);
      toast.success(ui.projects.updatedDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
    },
  });
}

/** Статус: завершение — метка, архив — заморозка, возврат в работу (Т6).
 *  id — переменная: одна мутация обслуживает карточку и строку журнала. */
export function useProjectStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProjectStatus }) =>
      api<ProjectDetail>(`/projects/${id}/status`, { method: 'POST', body: { status } }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: projectsKeys.detail(id) });
      const previous = queryClient.getQueryData<ProjectDetail>(projectsKeys.detail(id));
      const now = new Date().toISOString();
      replaceInJournal(queryClient, id, { status });
      if (previous) {
        queryClient.setQueryData<ProjectDetail>(projectsKeys.detail(id), {
          ...previous,
          status,
          completedAt: status === 'completed' ? now : null,
          archivedAt: status === 'archived' ? now : null,
        });
      }
      return { previous, id };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectsKeys.detail(context.id), context.previous);
      }
      toastApiError(error);
    },
    onSuccess: (project) => {
      queryClient.setQueryData(projectsKeys.detail(project.id), project);
      replaceInJournal(queryClient, project.id, project);
      toast.success(ui.projects.statusChangedDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
    },
  });
}

/** Передача руководства (только действующий руководитель, Т5). */
export function useTransferProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { managerId: string; manager: UserRef }) =>
      api<ProjectDetail>(`/projects/${id}/transfer`, {
        method: 'POST',
        body: { managerId: vars.managerId },
      }),
    onMutate: async ({ managerId, manager }) => {
      const previous = queryClient.getQueryData<ProjectDetail>(projectsKeys.detail(id));
      replaceInJournal(queryClient, id, {
        manager,
        assistants: previous?.assistants.filter((a) => a.id !== managerId) ?? [],
      });
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(projectsKeys.detail(id), context.previous);
      toastApiError(error);
    },
    onSuccess: (project) => {
      queryClient.setQueryData(projectsKeys.detail(id), project);
      replaceInJournal(queryClient, id, project);
      toast.success(ui.projects.transferDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['chat'] });
    },
  });
}
