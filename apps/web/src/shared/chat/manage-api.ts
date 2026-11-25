import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, ui } from '@nodus/contracts';
import type { ConversationListItem, ConversationMember, Paginated } from '@nodus/contracts';
import { toast } from 'sonner';

import { ApiError, api } from '../api-client.js';
import { chatKeys } from './chat-keys.js';
import { invalidateConversationLists } from './conversation-list-invalidation.js';
import { uploadAvatar } from './avatar-upload.js';

/**
 * Хуки управления беседой (#186): переименование (changeInfo), аватар
 * (changeInfo), участники (addMembers/removeMembers/manageSettings — матрица
 * беседы). Живут в shared: потребители — топбар беседы, панель участников и
 * окно создания (features/chat), все хосты чата получают их одним кодом.
 */

/** Переименование — оптимистичное (I4): название в списке бесед меняется до
 *  ответа сервера, откат + тост при ошибке. */
export function useRenameConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api<ConversationListItem>(`/chat/conversations/${id}/info`, {
        method: 'PATCH',
        body: { title },
      }),
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey: chatKeys.conversations() });
      const previous = queryClient.getQueryData<Paginated<ConversationListItem>>(
        chatKeys.conversations(),
      );
      queryClient.setQueryData<Paginated<ConversationListItem>>(chatKeys.conversations(), (old) =>
        old
          ? {
              ...old,
              items: old.items.map((c) => (c.id === id ? { ...c, title } : c)),
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(chatKeys.conversations(), context.previous);
      }
      toast.error(ui.common.saveError);
    },
    onSettled: () => {
      void invalidateConversationLists(queryClient);
    },
  });
}

/** Установка/смена аватара беседы: файл → multipart (квадратизация на
 *  сервере, sharp WebP) → свежий ConversationListItem; список инвалидируется.
 *  conversationId — переменная мутации (не проп хука): окно создания грузит
 *  аватар беседе, id которой узнаёт ТОЛЬКО после POST create — замыкание
 *  хука увидело бы пустой id (stale-closure, урок #87/gotchas). */
export function useSetConversationAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, file }: { conversationId: string; file: File }) =>
      uploadAvatar<ConversationListItem>(
        { path: `/chat/conversations/${conversationId}/avatar`, domain: 'chat' },
        file,
      ),
    onSuccess: () => {
      toast.success(ui.common.avatarSaved);
    },
    onSettled: () => {
      void invalidateConversationLists(queryClient);
    },
  });
}

/** Убрать аватар беседы (вернётся заглушка из инициалов). */
export function useRemoveConversationAvatar(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<ConversationListItem>(`/chat/conversations/${conversationId}/avatar`, {
        method: 'DELETE',
      }),
    onSettled: () => {
      void invalidateConversationLists(queryClient);
    },
  });
}

/** Участники беседы с ролями (#186): бесконечными страницами по 100 (потолок
 *  беседы 200 участников — чаще всего всё входит в первую). enabled — ленивые
 *  потребители (#176: автокомплит тянет состав при первом «@», не при монтировке). */
export function useConversationMembers(
  conversationId: string,
  search = '',
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: [...chatKeys.members(conversationId), search],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '100' });
      if (search) params.set('search', search);
      if (pageParam) params.set('cursor', pageParam);
      return api<Paginated<ConversationMember>>(
        `/chat/conversations/${conversationId}/members?${params}`,
      );
    },
    enabled: conversationId.length > 0 && enabled,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Добавление участников (право addMembers; сервер пропускает состоящих). */
export function useAddMembers(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api<ConversationListItem>(`/chat/conversations/${conversationId}/members`, {
        method: 'POST',
        body: { userIds },
      }),
    onSuccess: () => {
      toast.success(ui.chat.membersAdded);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError && error.code === ErrorCode.CHAT_MEMBERS_LIMIT_REACHED
          ? ui.chat.membersLimitReached
          : ui.common.saveError,
      );
    },
    onSettled: () => {
      void invalidateConversationLists(queryClient);
      void queryClient.invalidateQueries({ queryKey: chatKeys.members(conversationId) });
    },
  });
}

/** Смена роли: модератор ⇄ участник (право manageSettings — владелец). */
export function useUpdateMemberRole(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' }) =>
      api<ConversationMember>(`/chat/conversations/${conversationId}/members/${userId}`, {
        method: 'PATCH',
        body: { role },
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.members(conversationId) });
    },
  });
}

/** Исключение участника (право removeMembers + иерархия ролей). */
export function useRemoveMember(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/chat/conversations/${conversationId}/members/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast.success(ui.chat.memberRemoved);
    },
    onSettled: () => {
      void invalidateConversationLists(queryClient);
      void queryClient.invalidateQueries({ queryKey: chatKeys.members(conversationId) });
    },
  });
}
