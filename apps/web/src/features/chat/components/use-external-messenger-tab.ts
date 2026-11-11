import { useEffect, useState } from 'react';

import {
  messengerTabForType,
  subscribeMessengerConversation,
  takeMessengerConversation,
} from '../../../shared/chat/messenger-nav.js';

/**
 * Внешнее открытие беседы (клик по уведомлению, #719): карточка мессенджера
 * выбирает вкладку по ТИПУ уже разрешённой беседы — чат задачи/письма живёт
 * на «Чатах задач и писем», иначе беседа «пропадала» из списка «Чатов».
 *
 * Пристойка (messenger-nav) ставится только кликом по уведомлению, поэтому
 * ручной выбор вкладки не перебивается. Без `onTabChange` (страница `?tab=`
 * или спящая нижняя карточка) пристойку НЕ потребляем: её заберёт карточка,
 * которая реально станет верхней.
 */
export function useExternalMessengerTab(
  active: { id: string; type: string } | null | undefined,
  onTabChange: ((tab: 'chats' | 'tasks') => void) | undefined,
): void {
  const [tick, setTick] = useState(0);
  // Подписка — случай «карточка этой беседы уже открыта»: openCard на той же
  // верхней карточке — no-op, но вкладку переключить всё равно нужно.
  useEffect(() => subscribeMessengerConversation(() => setTick((n) => n + 1)), []);
  const activeId = active?.id;
  const activeType = active?.type;
  useEffect(() => {
    if (!onTabChange || !activeId || !activeType) return;
    if (!takeMessengerConversation(activeId)) return;
    onTabChange(messengerTabForType(activeType));
  }, [onTabChange, activeId, activeType, tick]);
}
