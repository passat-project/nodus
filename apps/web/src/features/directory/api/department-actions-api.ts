import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  DepartmentNode,
  OrgUnitKind,
  Paginated,
  UpdateUserDto,
  UserCard,
  UserListItem,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { usersListKey } from '../../../shared/api/users-list.js';
import { removeDepartment } from '../lib/department-tree.js';
import { directoryKeys } from './directory-keys.js';

/**
 * Мутации действий с подразделением (#881), вынесены из общего `directory-api`
 * (I5). Удаление — оптимистичное (ветка исчезает до ответа, откат снапшотом);
 * перевод — оптимистично меняет `departmentId` в справочнике.
 */

/** Удаление подразделения с переносом: дерево вида рефечится, имена/счётчики
 *  обновляет инвалидация. */
export function useDeleteDepartment(kind: OrgUnitKind) {
  const queryClient = useQueryClient();
  const key = directoryKeys.departments(kind);
  return useMutation({
    mutationFn: (id: string) => api<void>(`/directory/departments/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DepartmentNode[]>(key);
      if (previous) queryClient.setQueryData(key, removeDepartment(previous, id));
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toastApiError(error);
    },
    onSuccess: () => {
      toast.success(ui.employees.deleteDepartmentDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Перевод сотрудника в подразделение: PATCH карточки; сервер снимает старую
 *  руководящую роль, пересчитывает `managerId` и отзывает access-токены. */
export function useTransferEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, departmentId }: { userId: string; departmentId: string }) =>
      api<UserCard>(`/directory/users/${userId}`, {
        method: 'PATCH',
        body: { departmentId } satisfies UpdateUserDto,
      }),
    onMutate: async ({ userId, departmentId }) => {
      await queryClient.cancelQueries({ queryKey: usersListKey });
      const previous = queryClient.getQueryData<Paginated<UserListItem>>(usersListKey);
      if (previous) {
        queryClient.setQueryData<Paginated<UserListItem>>(usersListKey, {
          ...previous,
          items: previous.items.map((user) =>
            user.id === userId ? { ...user, departmentId } : user,
          ),
        });
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(usersListKey, context.previous);
      toastApiError(error);
    },
    onSuccess: () => {
      toast.success(ui.employees.transferEmployeeDone);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}
