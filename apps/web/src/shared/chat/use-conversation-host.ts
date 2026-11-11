import { useEffect } from 'react';

import { useSurfaceVisible } from '../lib/surface-visibility.js';
import { useConvRoom } from '../socket/use-conv-room.js';
import { acquireOpenConversation } from './open-conversation.js';

/**
 * Хост ленты беседы (лента, тред, заметки, «Новости» — в мессенджере,
 * карточке задачи, письма, сотрудника): беседа «открыта» для гейта
 * уведомлений (#124/#300) И подписана на свою WS-комнату (#351) — без
 * комнаты не доходят прочтения (галочки отправителя), «печатает…»,
 * реакции, закрепы. Оба реестра со счётчиком хостов: уход одного хоста не
 * гасит другой. Каждый новый хост ленты обязан вызывать этот хук.
 *
 * Видимость поверхности (#770): накрытая карточка (dormant в стеке) беседу
 * «не открывает» — попапы этой беседы продолжают приходить, а квитанции
 * прочтения молчат. Возврат карточки на вид — снова открыта (и попапы
 * гасятся, модель Telegram unlinkHistory). WS-комната живёт всегда.
 */
export function useConversationHost(conversationId: string | null | undefined): void {
  const surfaceVisible = useSurfaceVisible();
  useEffect(
    () => (conversationId && surfaceVisible ? acquireOpenConversation(conversationId) : undefined),
    [conversationId, surfaceVisible],
  );
  useConvRoom(conversationId);
}
