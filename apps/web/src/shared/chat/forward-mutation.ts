import type { ChatMessage, ForwardMessagesBody } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '../api-client.js';
import { chatKeys } from './chat-keys.js';
import { invalidateConversationLists } from './conversation-list-invalidation.js';
import { useScrollEndStore } from './scroll-end-store.js';

/** Пересылка (линия A #87): без оптимистики — приёмник рефечится. */
export function useForwardMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { targetId: string; body: ForwardMessagesBody }) =>
      api<ChatMessage[]>(`/chat/conversations/${vars.targetId}/forward`, {
        method: 'POST',
        body: vars.body,
      }),

    onSuccess: (_created, vars) => {
      void qc.invalidateQueries({ queryKey: chatKeys.messages(vars.targetId) });
      void invalidateConversationLists(qc);
      // Догон ленты приёмника к низу для отправителя (раунд 4): батч из
      // мультиселекта идёт через эту мутацию МИМО композера (у одиночной
      // пересылки догон просит композер) — без запроса отправитель оставался
      // без прокрутки к своему новому сообщению (вердикт раунда 4).
      const scope = vars.body.threadRootId
        ? `thread:${vars.body.threadRootId}`
        : `conversation:${vars.targetId}`;
      useScrollEndStore.getState().request(scope, 'smooth');
      // Тостов здесь нет: пересылка одиночная (вердикт 24.09); тост успеха —
      // в композере-инициаторе (chat-composer).
    },

    onError: () => {
      toast.error(ui.common.sendError);
    },
  });
}
