import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDepartmentDto,
  CreatePositionDto,
  Department,
  DepartmentNode,
  OrgUnitKind,
  Position,
  PresenceEntry,
  PresenceStatus,
  UpdateDepartmentDto,
  UpdatePositionDto,
  UpdateUserDto,
  UserCard,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { isDomainMocked } from '../../../shared/api/api-mock-config.js';
import { DEPARTMENTS_TREE_PATH } from '../../../shared/api/departments-list.js';
import { invalidateChatAvatarCaches } from '../../../shared/chat/avatar-cache.js';
import { uploadAvatar } from '../../../shared/chat/avatar-upload.js';
import { useIsOnline } from '../../../shared/socket/presence-store.js';
import { insertDepartment, patchDepartment } from '../lib/department-tree.js';

// Канонический хук справочника людей — shared (единый ключ/кэш); реэкспорт
// для обратной совместимости импортов фичи.
export { useUsersList } from '../../../shared/api/users-list.js';

export const directoryKeys = {
  all: ['directory'] as const,
  users: () => [...directoryKeys.all, 'users'] as const,
  userCard: (id: string) => [...directoryKeys.all, 'user', id] as const,
  presence: () => [...directoryKeys.all, 'presence'] as const,
  departments: (kind: OrgUnitKind) => [...directoryKeys.all, 'departments', kind] as const,
};

/**
 * Дерево оргструктуры вида (#84, #540): лес корней DepartmentNode по
 * контрактному пути `/directory/departments/tree` (единая константа
 * `DEPARTMENTS_TREE_PATH`, страж-тест). Вид «Подразделения» и панель рисуются
 * из него.
 */
export function useDepartmentTree(kind: OrgUnitKind) {
  return useQuery({
    queryKey: directoryKeys.departments(kind),
    queryFn: () => api<DepartmentNode[]>(`${DEPARTMENTS_TREE_PATH}?kind=${kind}`),
  });
}

/** Создание подразделения: оптимистичная вставка узла в дерево вида (I4) —
 *  карточка появляется до ответа, откат при ошибке; имена руководителя/зама
 *  и счётчики доносит инвалидация после ответа. */
export function useCreateDepartment(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  const key = directoryKeys.departments(kind);
  return useMutation({
    mutationFn: (body: CreateDepartmentDto) =>
      api<Department>('/directory/departments', { method: 'POST', body }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DepartmentNode[]>(key);
      const temp: DepartmentNode = {
        id: `temp-${crypto.randomUUID()}`,
        name: body.name,
        kind: body.kind ?? kind,
        parentId: body.parentId ?? null,
        headId: body.headId ?? null,
        deputyId: body.deputyId ?? null,
        sortOrder: body.sortOrder ?? 0,
        isActive: true,
        headName: null,
        deputyName: null,
        memberCount: 0,
        children: [],
      };
      if (previous) queryClient.setQueryData(key, insertDepartment(previous, temp));
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toastApiError(_error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Правка подразделения (название/руководитель/зам): оптимистичный патч узла (I4). */
export function useUpdateDepartment(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  const key = directoryKeys.departments(kind);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDepartmentDto }) =>
      api<Department>(`/directory/departments/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DepartmentNode[]>(key);
      if (previous) queryClient.setQueryData(key, patchDepartment(previous, id, patch));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toastApiError(_error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Полная карточка сотрудника (UserCard) — вкладка «Профиль». */
export function useUserCard(id: string) {
  return useQuery({
    queryKey: directoryKeys.userCard(id),
    queryFn: () => api<UserCard>(`/directory/users/${id}`),
  });
}

/** Справочник должностей вида (GET /directory/positions?kind=, #441):
 *  выбор должности при правке сотрудника и отчёт «должности без сотрудников».
 *  Хук живёт в shared (#433): его использует и редактор маршрутов. */
export { usePositions } from '../../../shared/api/positions.js';

/** Правка оргструктурных полей сотрудника (#441, право directory.manage):
 *  подразделение, должность, руководитель (свободная ссылка — кейс ГИПов).
 *  Оптимистичный патч карточки (I4), откат при ошибке, инвалидация дерева и
 *  списков после ответа (имена/счётчики считает сервер). */
export function useUpdateUser(id: string) {
  const queryClient = useQueryClient();
  const cardKey = directoryKeys.userCard(id);
  return useMutation({
    mutationFn: (body: UpdateUserDto) =>
      api<UserCard>(`/directory/users/${id}`, { method: 'PATCH', body }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: cardKey });
      const previous = queryClient.getQueryData<UserCard>(cardKey);
      if (previous) queryClient.setQueryData(cardKey, { ...previous, ...body });
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(cardKey, context.previous);
      toastApiError(_error);
    },
    onSuccess: (card) => {
      queryClient.setQueryData(cardKey, card);
      toast.success(ui.employees.editSaved);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Должности вида — мутации администратора (#441): создание, переименование,
 *  архивация (I15: удаления нет). Инвалидация справочника и отчёта данных. */
export function useCreatePosition(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePositionDto) =>
      api<Position>('/directory/positions', { method: 'POST', body }),
    onError: (error) => toastApiError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [...directoryKeys.all, 'positions', kind] });
      // Список сотрудников несёт денормализованный positionName — освежаем.
      void queryClient.invalidateQueries({ queryKey: directoryKeys.users() });
    },
  });
}

export function useUpdatePosition(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePositionDto }) =>
      api<Position>(`/directory/positions/${id}`, { method: 'PATCH', body: patch }),
    onError: (error) => toastApiError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [...directoryKeys.all, 'positions', kind] });
      // Переименование должности видно в «Списке» и панели (positionName).
      void queryClient.invalidateQueries({ queryKey: directoryKeys.users() });
    },
  });
}

export function useArchivePosition(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/directory/positions/${id}/archive`, { method: 'POST' }),
    onError: (error) => toastApiError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [...directoryKeys.all, 'positions', kind] });
      void queryClient.invalidateQueries({ queryKey: directoryKeys.users() });
    },
  });
}

/** Архивация подразделения (#441, I15: не удаление): дерево вида рефечится —
 *  поддерево уходит из структуры, история и привязки ролей сохраняются. */
export function useArchiveDepartment(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/directory/departments/${id}/archive`, { method: 'POST' }),
    onError: (error) => toastApiError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.departments(kind) });
      // Список сотрудников несёт денормализованный departmentName.
      void queryClient.invalidateQueries({ queryKey: directoryKeys.users() });
    },
  });
}

/** Аватар СВОЕГО профиля (#186): multipart (квадратизация на сервере),
 *  чужие карточки — только просмотр. Инвалидация — вся ветка directory
 *  (карточка + списки/пикеры, где аватар тоже виден) И кэш чата (#726:
 *  в DTO сообщения — копия `author.avatarUrl`, без инвалидации старые
 *  пузыри/беседы жили со старым фото до F5). */
export function useSetMyAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      uploadAvatar<UserCard>({ path: '/directory/users/me/avatar', domain: 'directory' }, file),
    onSuccess: () => {
      toast.success(ui.common.avatarSaved);
    },
    // Отказ сервера обязан быть виден (#725): фото 24 Мп молча отклонялось
    // пиксельным потолком — «просто ничего не происходит». Тост — по коду
    // ошибки (для потолка — свой текст «слишком большое разрешение»).
    onError: (error) => toastApiError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
      invalidateChatAvatarCaches(queryClient);
    },
  });
}

/** Убрать аватар своего профиля (вернутся инициалы). */
export function useRemoveMyAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<UserCard>('/directory/users/me/avatar', { method: 'DELETE' }),
    onError: (error) => toastApiError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
      invalidateChatAvatarCaches(queryClient);
    },
  });
}

/** REST presence — только мок-режим (живого эндпоинта в api нет: presence
 *  эфемерный и живёт в WS-gateway, #104). */
export function usePresence() {
  return useQuery({
    queryKey: directoryKeys.presence(),
    queryFn: () => api<PresenceEntry[]>('/directory/presence'),
    enabled: isDomainMocked('directory'),
  });
}

/** Статус сотрудника для чипа: мок — REST-моки, живой режим — WS presence
 *  (gateway, #104; онлайн = есть живые соединения). */
export function useEmployeePresence(userId: string): PresenceStatus {
  const { data: presence } = usePresence();
  const wsOnline = useIsOnline(userId);
  if (isDomainMocked('directory')) {
    return presence?.find((p) => p.user.id === userId)?.status ?? 'offline';
  }
  return wsOnline ? 'online' : 'offline';
}
