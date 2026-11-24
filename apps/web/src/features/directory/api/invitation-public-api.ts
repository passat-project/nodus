import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AcceptInvitationDto,
  AcceptPasswordResetDto,
  AcceptResponse,
  InvitationInfo,
  PasswordResetInfo,
} from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';

/**
 * Публичные запросы приглашения и сброса пароля (#101): без Bearer и без
 * refresh-retry (`auth: false`) — страницу открывает аноним по одноразовой
 * ссылке. Токен живёт только в памяти запроса, в БД — его хеш.
 */
export const invitationKeys = {
  info: (token: string) => ['invitation', 'info', token] as const,
  reset: (token: string) => ['invitation', 'reset', token] as const,
};

export function useInvitationInfo(token: string) {
  return useQuery({
    queryKey: invitationKeys.info(token),
    queryFn: () =>
      api<InvitationInfo>(`/invitations/${encodeURIComponent(token)}`, { auth: false }),
    retry: false,
  });
}

export function useAcceptInvitation(token: string) {
  return useMutation({
    mutationFn: (body: AcceptInvitationDto) =>
      api<AcceptResponse>(`/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body,
        auth: false,
      }),
  });
}

export function usePasswordResetInfo(token: string) {
  return useQuery({
    queryKey: invitationKeys.reset(token),
    queryFn: () =>
      api<PasswordResetInfo>(`/password-resets/${encodeURIComponent(token)}`, { auth: false }),
    retry: false,
  });
}

export function useAcceptPasswordReset(token: string) {
  return useMutation({
    mutationFn: (body: AcceptPasswordResetDto) =>
      api<AcceptResponse>(`/password-resets/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body,
        auth: false,
      }),
  });
}
