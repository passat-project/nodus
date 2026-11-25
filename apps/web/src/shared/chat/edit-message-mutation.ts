import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '../api-client.js';
import { chatKeys } from './chat-keys.js';
import { invalidateConversationLists } from './conversation-list-invalidation.js';
import { useChatDrafts } from './chat-drafts.js';
import { mapMessage, restoreSnapshot, snapshotMessages } from './message-cache.js';
import type { EditMessageVars } from './message-edit.js';

/** Правка сообщения (линия A #87): оптимистичный текст/состав вложений,
 *  откат по снапшоту (общий паттерн — message-cache.ts). */
export function useEditMessage(conversationId: string, draftScope?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: EditMessageVars) =>
      api<ChatMessage>(`/chat/conversations/${conversationId}/messages/${vars.messageId}`, {
        method: 'PATCH',
        body: {
          text: vars.text,
          // attachmentIds есть = полный итоговый состав из окна правки
          // (#188); отсутствует = инлайн-правка текста, состав не трогаем.
          ...(vars.attachmentIds !== undefined ? { attachmentIds: vars.attachmentIds } : {}),
          ...(vars.attachmentRenames !== undefined
            ? { attachmentRenames: vars.attachmentRenames }
            : {}),
        },
      }),

    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: chatKeys.messages(conversationId) });
      const snapshot = snapshotMessages(qc, conversationId);
      // «Повторный пуш прочитавшим» (решение #41): editedAt + сброс readAt —
      // галочки read→sent видны сразу (модель поведения до WS M13). Состав
      // вложений (#188): окно дало оптимистичный список — применяем ДО
      // ответа сервера (I4).
      mapMessage(qc, conversationId, vars.messageId, (m) => ({
        ...m,
        text: vars.text,
        editedAt: new Date().toISOString(),
        readAt: null,
        ...(vars.optimisticAttachments !== undefined
          ? { attachments: vars.optimisticAttachments }
          : {}),
      }));
      return { snapshot };
    },

    onError: (_error, _vars, context) => {
      if (context) restoreSnapshot(qc, context.snapshot);
      toast.error(ui.common.saveError);
    },

    onSuccess: (server, vars) => {
      mapMessage(qc, conversationId, vars.messageId, () => server);
      // Правка применена — режим правки выходим по успеху (#124): до ответа
      // сервера текст остаётся в композере (ошибка не теряет правку).
      if (draftScope) useChatDrafts.getState().finishEdit(draftScope);
    },

    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
      void invalidateConversationLists(qc);
      void qc.invalidateQueries({ queryKey: chatKeys.pins(conversationId) });
    },
  });
}
