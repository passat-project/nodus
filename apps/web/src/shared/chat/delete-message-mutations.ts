import type { BatchDeleteMessagesResult, ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '../api-client.js';
import { chatKeys } from './chat-keys.js';
import { invalidateConversationLists } from './conversation-list-invalidation.js';
import {
  cachedHasLiveReplies,
  mapMessage,
  predictTombstone,
  restoreSnapshot,
  snapshotMessages,
  upsertMessage,
} from './message-cache.js';

/** Удаление: conversationId — В ПЕРЕМЕННЫХ мутации, не в замыкании хука.
 *  Хост диалога закрывается сразу после mutate() (request → null), и TanStack
 *  берёт mutationFn из опций ПОСЛЕДНЕГО рендера — замыкание с пустым id
 *  давало DELETE /conversations//messages/… 404 (баг скриншот-прогона 24.09). */
export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    /** 204 — живых ответов нет (бесследно); 200 + надгробие — есть ответы. */
    mutationFn: (vars: { conversationId: string; messageId: string }) =>
      api<ChatMessage | undefined>(
        `/chat/conversations/${vars.conversationId}/messages/${vars.messageId}`,
        { method: 'DELETE' },
      ),

    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: chatKeys.messages(vars.conversationId) });
      const snapshot = snapshotMessages(qc, vars.conversationId);
      mapMessage(qc, vars.conversationId, vars.messageId, (m) =>
        cachedHasLiveReplies(qc, vars.conversationId, vars.messageId) ? predictTombstone(m) : null,
      );
      return { snapshot };
    },

    onError: (_error, _vars, context) => {
      if (context) restoreSnapshot(qc, context.snapshot);
      toast.error(ui.common.saveError);
    },

    onSuccess: (server, vars) => {
      if (server) upsertMessage(qc, vars.conversationId, server);
    },

    onSettled: (_data, _error, vars) => {
      void qc.invalidateQueries({ queryKey: chatKeys.messages(vars.conversationId) });
      void invalidateConversationLists(qc);
      void qc.invalidateQueries({ queryKey: chatKeys.pins(vars.conversationId) });
    },
  });
}

export function useBatchDeleteMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { conversationId: string; messageIds: string[] }) =>
      api<BatchDeleteMessagesResult>(
        `/chat/conversations/${vars.conversationId}/messages/batch-delete`,
        { method: 'POST', body: { messageIds: vars.messageIds } },
      ),

    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: chatKeys.messages(vars.conversationId) });
      const snapshot = snapshotMessages(qc, vars.conversationId);
      for (const id of vars.messageIds) {
        mapMessage(qc, vars.conversationId, id, (m) =>
          cachedHasLiveReplies(qc, vars.conversationId, id) ? predictTombstone(m) : null,
        );
      }
      return { snapshot };
    },

    onError: (_error, _vars, context) => {
      if (context) restoreSnapshot(qc, context.snapshot);
      toast.error(ui.common.saveError);
    },

    onSuccess: (result, vars) => {
      // Сервер — истина: прогноз (по кэшу окна) может разойтись с ответами
      // вне загруженного окна.
      for (const id of result.removed) mapMessage(qc, vars.conversationId, id, () => null);
      for (const tombstone of result.tombstones) {
        upsertMessage(qc, vars.conversationId, tombstone);
      }
    },

    onSettled: (_data, _error, vars) => {
      void qc.invalidateQueries({ queryKey: chatKeys.messages(vars.conversationId) });
      void invalidateConversationLists(qc);
      void qc.invalidateQueries({ queryKey: chatKeys.pins(vars.conversationId) });
    },
  });
}
