import { useCallback } from 'react';
import type { SearchHit } from '@nodus/contracts';

import { openCardViaBridge } from '../../../shared/lib/card-bridge.js';
import {
  stageMessengerConversation,
  stageMessengerThread,
} from '../../../shared/chat/messenger-nav.js';
import { useJumpStore } from '../../../shared/chat/jump-store.js';
import { useSearchStore } from '../model/search-store.js';

/**
 * Открытие результата поиска (#952 Р12): закрыть окно → карточка в стеке.
 * Сообщение — мессенджер на беседе + существующий `jump-store` (скролл,
 * вспышка 2 с, бэкфилл до 30 страниц); ответ в треде — сначала пристойка
 * треда. Нового API контекста нет.
 *
 * Карточка открывается МОСТОМ `openCardViaBridge` — фича не импортирует
 * каркас (направление слоёв app → features → shared, аудит #45).
 */
export function useOpenSearchHit() {
  const close = useSearchStore((state) => state.close);
  return useCallback(
    (hit: SearchHit) => {
      close();
      switch (hit.type) {
        case 'task':
          openCardViaBridge({ kind: 'task', id: hit.id });
          return;
        case 'letter':
          openCardViaBridge({ kind: 'letter', id: hit.id });
          return;
        case 'project':
          openCardViaBridge({ kind: 'project', id: hit.id });
          return;
        case 'employee':
          openCardViaBridge({ kind: 'employee', id: hit.id });
          return;
        case 'message': {
          const { conversationId, messageId, threadRootId } = hit.meta;
          stageMessengerConversation(conversationId);
          if (threadRootId !== null) stageMessengerThread(conversationId, threadRootId);
          useJumpStore.getState().request(conversationId, messageId, threadRootId);
          openCardViaBridge({ kind: 'messenger', id: conversationId });
          return;
        }
      }
    },
    [close],
  );
}
