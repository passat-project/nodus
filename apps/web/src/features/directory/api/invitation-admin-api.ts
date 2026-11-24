import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateInvitationDto,
  InvitationCreated,
  IssuePasswordResetResponse,
  Paginated,
  UserListItem,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { directoryKeys } from './directory-keys.js';

/** Админские мутации приглашений и сброса пароля (#101). Вынесены из
 *  `directory-api.ts` (I5): список сотрудников и жизненный цикл — там. */

export function useCreateInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInvitationDto) =>
      api<InvitationCreated>('/directory/invitations', { method: 'POST', body }),
    // Ошибки разбирает диалог приглашения (#101): дубль почты — под полем,
    // тост остаётся только для неожиданных сбоев (вызывающий).
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Перевыпуск: прежняя ссылка гаснет, новая отдаётся один раз. */
export function useReissueInvitation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<InvitationCreated>(`/directory/invitations/${userId}/reissue`, { method: 'POST' }),
    onError: (error) => toastApiError(error),
    onSuccess: () => toast.success(ui.employees.inviteReissueDone),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Отмена: строка уходит из списка сразу (I4). */
export function useCancelInvitation(userId: string) {
  const queryClient = useQueryClient();
  const usersKey = directoryKeys.users();
  return useMutation({
    mutationFn: () => api<void>(`/directory/invitations/${userId}`, { method: 'DELETE' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: usersKey });
      const previous = queryClient.getQueryData<Paginated<UserListItem>>(usersKey);
      if (previous) {
        queryClient.setQueryData(usersKey, {
          ...previous,
          items: previous.items.filter((user) => user.id !== userId),
        });
      }
      return { previous };
    },
    onError: (error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(usersKey, context.previous);
      toastApiError(error);
    },
    onSuccess: () => toast.success(ui.employees.inviteCancelled),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    },
  });
}

/** Ссылка сброса пароля (24 часа): админ передаёт вручную, сессии гасит
 *  сервер событием. */
export function useIssuePasswordReset(userId: string) {
  return useMutation({
    mutationFn: () =>
      api<IssuePasswordResetResponse>(`/directory/users/${userId}/password-reset`, {
        method: 'POST',
      }),
    onError: (error) => toastApiError(error),
  });
}
