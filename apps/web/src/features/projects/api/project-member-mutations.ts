import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomFieldRef, CustomFieldValue, ProjectDetail, UserRef } from '@nodus/contracts';
import { ErrorCode, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { ApiError, api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { cachedUsers, patchMemberPages, userRefOf } from './project-mutation-helpers.js';

/** «Присоединиться» (открытый, не-участник) — наблюдатель-вступивший. */
export function useJoinProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/projects/${id}/join`, { method: 'POST' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: projectsKeys.detail(id) });
      const previous = queryClient.getQueryData<ProjectDetail>(projectsKeys.detail(id));
      const me = useAuthStore.getState().user;
      if (previous && me) {
        const actor: UserRef = { id: me.id, displayName: me.displayName, avatarUrl: null };
        // Вступление — ряд НАБЛЮДАТЕЛЯ: «Участники» (membersCount) не меняются,
        // наблюдатель добавляется в отдельное поле карточки (вердикт 07.11.2026).
        queryClient.setQueryData<ProjectDetail>(projectsKeys.detail(id), {
          ...previous,
          myMembership: { ...previous.myMembership, observer: true },
          observers: previous.observers.some((entry) => entry.id === me.id)
            ? previous.observers
            : [...previous.observers, actor],
          access: { ...previous.access, canJoin: false, canLeave: true },
        });
        patchMemberPages(queryClient, id, (items) => [
          ...items.filter((row) => !(row.user.id === me.id && row.source === 'observer')),
          {
            user: actor,
            source: 'observer',
            observerKind: 'joined',
            joinedAt: new Date().toISOString(),
          },
        ]);
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(projectsKeys.detail(id), context.previous);
      void queryClient.invalidateQueries({ queryKey: projectsKeys.members(id) });
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.joinedDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['chat'] });
    },
  });
}

/** «Покинуть» — только свой ряд вступившего наблюдателя. */
export function useLeaveProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/projects/${id}/leave`, { method: 'POST' }),
    onMutate: async () => {
      const previous = queryClient.getQueryData<ProjectDetail>(projectsKeys.detail(id));
      const me = useAuthStore.getState().user;
      if (previous && me) {
        queryClient.setQueryData<ProjectDetail>(projectsKeys.detail(id), {
          ...previous,
          myMembership: { ...previous.myMembership, observer: false },
          observers: previous.observers.filter((entry) => entry.id !== me.id),
          access: { ...previous.access, canJoin: true, canLeave: false },
        });
        patchMemberPages(queryClient, id, (items) =>
          items.filter((row) => !(row.user.id === me.id && row.source === 'observer')),
        );
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(projectsKeys.detail(id), context.previous);
      void queryClient.invalidateQueries({ queryKey: projectsKeys.members(id) });
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.projects.leftDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['chat'] });
    },
  });
}

/** Ручное добавление в секретный проект (участник или наблюдатель). */
export function useAddProjectMember(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; kind: 'member' | 'observer' }) =>
      api<void>(`/projects/${id}/members`, { method: 'POST', body: vars }),
    onMutate: async ({ userId, kind }) => {
      const user = userRefOf(userId, cachedUsers(queryClient));
      let added = false;
      patchMemberPages(queryClient, id, (items) => {
        added = !items.some((row) => row.user.id === userId);
        const kept = items.filter(
          (row) => row.user.id !== userId || !['member', 'observer'].includes(row.source),
        );
        return [
          ...kept,
          {
            user,
            source: kind,
            observerKind: kind === 'observer' ? 'invited' : null,
            joinedAt: new Date().toISOString(),
          },
        ];
      });
      if (added) {
        queryClient.setQueryData<ProjectDetail>(projectsKeys.detail(id), (data) => {
          if (!data) return data;
          if (kind === 'observer') {
            return data.observers.some((entry) => entry.id === userId)
              ? data
              : { ...data, observers: [...data.observers, user] };
          }
          return { ...data, membersCount: data.membersCount + 1 };
        });
      }
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.members(id) });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(id) });
      toastApiError(error);
    },
    onSuccess: (_data, vars) =>
      toast.success(
        vars.kind === 'observer' ? ui.projects.observerAddedDone : ui.projects.memberAddedDone,
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['chat'] });
    },
  });
}

/** Снятие ручного состава: секретный — участник и наблюдатель, открытый —
 *  только наблюдатель (сервер снимает ровно то, что разрешено видимостью). */
export function useRemoveProjectMember(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; kind: 'member' | 'observer' }) =>
      api<void>(`/projects/${id}/members/${vars.userId}`, { method: 'DELETE' }),
    onMutate: async ({ userId, kind }) => {
      patchMemberPages(queryClient, id, (items) =>
        items.filter(
          (row) => !(row.user.id === userId && ['member', 'observer'].includes(row.source)),
        ),
      );
      queryClient.setQueryData<ProjectDetail>(projectsKeys.detail(id), (data) => {
        if (!data) return data;
        return kind === 'observer'
          ? { ...data, observers: data.observers.filter((entry) => entry.id !== userId) }
          : { ...data, membersCount: Math.max(data.membersCount - 1, 0) };
      });
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.members(id) });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(id) });
      // Снятие держателя ролей задач (#541): руководитель видит, какие задачи
      // держат сотрудника — «снимите с задач» с номерами, а не общий код.
      if (error instanceof ApiError && error.code === ErrorCode.PROJECT_MEMBER_HAS_TASKS) {
        const tasks =
          (error.details?.tasks as { number?: number; title?: string }[] | undefined) ?? [];
        const list = tasks
          .slice(0, 5)
          .map((task) => `№ ${task.number} «${task.title ?? ''}»`)
          .join(', ');
        toast.error(ui.projects.memberHasTasks.replace('{tasks}', list || '…'));
        return;
      }
      toastApiError(error);
    },
    onSuccess: (_data, vars) =>
      toast.success(
        vars.kind === 'observer' ? ui.projects.observerRemovedDone : ui.projects.memberRemovedDone,
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['chat'] });
    },
  });
}

/** Атрибут проекта: оптимистичная правка значения (I4). Выбранная ссылка
 *  мержится в `customFieldRefs` — иначе до ответа сервера свежее значение
 *  показывает «Запись недоступна» (#646). */
export function useUpdateProjectCustomField(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      fieldId: string;
      value: CustomFieldValue | null;
      refs?: readonly CustomFieldRef[];
    }) =>
      api<ProjectDetail>(`/projects/${id}`, {
        method: 'PATCH',
        body: { customFields: { [vars.fieldId]: vars.value } },
      }),
    onMutate: async ({ fieldId, value, refs }) => {
      const previous = queryClient.getQueryData<ProjectDetail>(projectsKeys.detail(id));
      if (previous) {
        const customFields = { ...previous.customFields };
        if (value === null) delete customFields[fieldId];
        else customFields[fieldId] = value;
        const merged = new Map(
          previous.customFieldRefs.map((ref) => [`${ref.kind}:${ref.id}`, ref]),
        );
        for (const ref of refs ?? []) merged.set(`${ref.kind}:${ref.id}`, ref);
        queryClient.setQueryData<ProjectDetail>(projectsKeys.detail(id), {
          ...previous,
          customFields,
          customFieldRefs: [...merged.values()],
        });
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(projectsKeys.detail(id), context.previous);
      toastApiError(error);
    },
    onSuccess: (project) => queryClient.setQueryData(projectsKeys.detail(id), project),
    onSettled: () => {
      // Шифр/заказчик — производные: журнал и пикеры тоже перечитываются,
      // иначе колонка «Шифр» показывает старое значение до полного рефеча.
      void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.journals() });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.options() });
    },
  });
}
