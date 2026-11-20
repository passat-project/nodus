import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDepartmentDto,
  CreatePositionDto,
  Department,
  DepartmentNode,
  OrgUnitKind,
  Position,
  UpdateDepartmentDto,
  UpdateMyProfileDto,
  UpdatePositionDto,
  UpdateUserDto,
  UserCard,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { DEPARTMENTS_TREE_PATH } from '../../../shared/api/departments-list.js';
import { invalidateChatAvatarCaches } from '../../../shared/chat/avatar-cache.js';
import { uploadAvatar } from '../../../shared/chat/avatar-upload.js';
import { insertDepartment, patchDepartment } from '../lib/department-tree.js';
import { directoryKeys } from './directory-keys.js';

// Канонический хук справочника людей — shared (единый ключ/кэш); реэкспорт
// для обратной совместимости импортов фичи.
export { useUsersList } from '../../../shared/api/users-list.js';
export { directoryKeys } from './directory-keys.js';
export { useEmployeePresence, usePresence } from './presence.js';

/**
 * Дерево оргструктуры вида (#84, #540): лес корней DepartmentNode по
 * контрактному пути `/directory/departments/tree` (единая константа
 * `DEPARTMENTS_TREE_PATH`, страж-тест). Дерево и панель отдела рисуются
 * из него.
 */
export function useDepartmentTree(kind: OrgUnitKind) {
  return useQuery({
    queryKey: directoryKeys.departments(kind),
    queryFn: () => api<DepartmentNode[]>(`${DEPARTMENTS_TREE_PATH}?kind=${kind}`),
  });
}

/** Создание отдела: оптимистичная вставка узла в дерево вида (I4) —
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
        deputyIds: body.deputyIds ?? [],
        sortOrder: body.sortOrder ?? 0,
        isActive: true,
        headName: null,
        deputies: [],
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

/** Правка отдела (название/руководитель/зам): оптимистичный патч узла (I4). */
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
 *  источник значений поля «Должность» в карточке и правке сотрудника.
 *  Хук живёт в shared (#433): его использует и редактор маршрутов. */
export { usePositions } from '../../../shared/api/positions.js';

/** Правка карточки сотрудника администратором (#441, #923): ФИО, контакты,
 *  HR-поля, подразделение/должность, роли. Руководитель не принимается — он
 *  производное поле сервера. Оптимистичный патч карточки (I4), откат при
 *  ошибке, инвалидация дерева и списков после ответа (имена/счётчики считает
 *  сервер). */
export function useUpdateUser(id: string, options?: { successMessage?: string }) {
  const queryClient = useQueryClient();
  const cardKey = directoryKeys.userCard(id);
  return useMutation({
    mutationFn: (body: UpdateUserDto) =>
      api<UserCard>(`/directory/users/${id}`, { method: 'PATCH', body }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: cardKey });
      const previous = queryClient.getQueryData<UserCard>(cardKey);
      if (previous) {
        // roleIds — не поле карточки: в оптимистичный кэш его не кладём.
        const fields: Record<string, unknown> = { ...body };
        delete fields.roleIds;
        queryClient.setQueryData(cardKey, { ...previous, ...fields } as UserCard);
      }
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(cardKey, context.previous);
      toastApiError(_error);
    },
    onSuccess: (card) => {
      queryClient.setQueryData(cardKey, card);
      toast.success(options?.successMessage ?? ui.employees.editSaved);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Саморедактирование своего профиля (#923): ФИО и личные/контактные поля —
 *  структура, email-логин, ставка/дата приёма и роли в схему не входят
 *  (серверный allowlist, I8). Оптимистично патчит СВОЮ карточку; после ответа
 *  обновляет auth-store — имя в топбаре меняется без перезагрузки. */
export function useUpdateMyProfile() {
  const queryClient = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const cardKey = meId ? directoryKeys.userCard(meId) : null;
  return useMutation({
    mutationFn: (body: UpdateMyProfileDto) =>
      api<UserCard>('/directory/users/me', { method: 'PATCH', body }),
    onMutate: async (body) => {
      if (!cardKey) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: cardKey });
      const previous = queryClient.getQueryData<UserCard>(cardKey);
      if (previous) {
        const next = { ...previous, ...body };
        // Имя — денормализация ФИО в топбаре и списках.
        if (body.lastName !== undefined || body.firstName !== undefined) {
          next.displayName = [next.lastName, next.firstName].filter(Boolean).join(' ');
        }
        queryClient.setQueryData(cardKey, next as UserCard);
      }
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (cardKey && context?.previous) queryClient.setQueryData(cardKey, context.previous);
      toastApiError(_error);
    },
    onSuccess: (card) => {
      if (cardKey) queryClient.setQueryData(cardKey, card);
      useAuthStore.getState().updateProfile({ displayName: card.displayName });
      toast.success(ui.employees.profileSaved);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Увольнение сотрудника (#923, право directory.manage): сервер снимает главу
 *  и зама во всех подразделениях и отзывает сессии; оптимистично меняем чип
 *  статуса, после ответа — серверная карточка и свежие списки. */
export function useDeactivateUser(id: string) {
  const queryClient = useQueryClient();
  const cardKey = directoryKeys.userCard(id);
  return useMutation({
    mutationFn: () => api<UserCard>(`/directory/users/${id}/deactivate`, { method: 'POST' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: cardKey });
      const previous = queryClient.getQueryData<UserCard>(cardKey);
      if (previous) queryClient.setQueryData(cardKey, { ...previous, status: 'deactivated' });
      return { previous };
    },
    onError: (error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(cardKey, context.previous);
      toastApiError(error);
    },
    onSuccess: (card) => {
      queryClient.setQueryData(cardKey, card);
      toast.success(ui.employees.deactivateDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Возврат деактивированного сотрудника в работу (AUD-016): оптимистично
 *  меняет статус карточки (I4), после ответа — серверная карточка и свежие
 *  списки. Сессии не восстанавливаются (вход заново), беседы и проекты —
 *  только вручную. */
export function useActivateUser(id: string) {
  const queryClient = useQueryClient();
  const cardKey = directoryKeys.userCard(id);
  return useMutation({
    mutationFn: () => api<UserCard>(`/directory/users/${id}/activate`, { method: 'POST' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: cardKey });
      const previous = queryClient.getQueryData<UserCard>(cardKey);
      if (previous) queryClient.setQueryData(cardKey, { ...previous, status: 'active' });
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(cardKey, context.previous);
      toastApiError(_error);
    },
    onSuccess: (card) => {
      queryClient.setQueryData(cardKey, card);
      toast.success(ui.employees.activateDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Создание должности вида — мутация администратора (#441, #768). Ошибки
 *  разбирает диалог создания (дубль названия — подсказкой в поле, остальные —
 *  тостом), поэтому общий тост здесь не дублируется. */
export function useCreatePosition(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePositionDto) =>
      api<Position>('/directory/positions', { method: 'POST', body }),
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

/** Удаление должности (#768, право `directory.manage`): сервер отказывает,
 *  если на должности остались сотрудники (включая уволенных) —
 *  `DIRECTORY_POSITION_IN_USE`; UI открывает переназначение. */
export function useDeletePosition(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/directory/positions/${id}`, { method: 'DELETE' }),
    // Причина отказа (держатели) разбирается панелью диалогом — общий тост
    // здесь дублировал бы её.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [...directoryKeys.all, 'positions', kind] });
      void queryClient.invalidateQueries({ queryKey: directoryKeys.users() });
    },
  });
}

/** Переназначение сотрудников должности (включая уволенных) на другую (#768):
 *  после успеха должность можно удалить — счётчик станет нулевым. */
export function useReassignPosition(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetId }: { id: string; targetId: string }) =>
      api<void>(`/directory/positions/${id}/reassign`, { method: 'POST', body: { targetId } }),
    onError: (error) => toastApiError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [...directoryKeys.all, 'positions', kind] });
      void queryClient.invalidateQueries({ queryKey: directoryKeys.users() });
    },
  });
}

/** Архивация отдела (#441, I15: не удаление): дерево вида рефечится —
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
