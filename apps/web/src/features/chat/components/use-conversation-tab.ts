import { useState } from 'react';

import { useConversationById } from '../../../shared/chat/chat-queries.js';
import { messengerTabForType } from '../../../shared/chat/messenger-nav.js';
import type { ChatTab } from './messenger-body.js';

interface TabState {
  conversationId: string;
  tab: ChatTab;
  /** Вкладку выбрал человек — тип беседы её больше не перебивает. */
  manual: boolean;
}

/**
 * Вкладка полноэкранной карточки мессенджера (#1062): следует ТИПУ беседы при
 * её смене (восстановление F5 из `?cards=`, пересылка, подмена карточки), но
 * ручной выбор вкладки не перебивается, пока беседа та же. Тип приходит
 * асинхронно (кэш/поиск беседы), поэтому состояние корректируется в рендере —
 * до коммита кадра, без мелькания чужого списка (приём card-stack-host).
 */
export function useConversationTab(conversationId: string): [ChatTab, (tab: ChatTab) => void] {
  const conversation = useConversationById(conversationId);
  const typeTab = conversation ? messengerTabForType(conversation.type) : undefined;
  const [state, setState] = useState<TabState>(() => ({
    conversationId,
    tab: typeTab ?? 'chats',
    manual: false,
  }));
  if (state.conversationId !== conversationId) {
    // Новая беседа — новый автоматический выбор вкладки; ручной выбор прошлой
    // беседы не наследуется.
    setState({ conversationId, tab: typeTab ?? 'chats', manual: false });
  } else if (!state.manual && typeTab && state.tab !== typeTab) {
    // Тип разрешился после первого кадра (F5, deep-link) — догоняем.
    setState({ ...state, tab: typeTab });
  }
  const setTab = (tab: ChatTab) =>
    setState((prev) => ({ ...prev, conversationId, tab, manual: true }));
  return [state.tab, setTab];
}
