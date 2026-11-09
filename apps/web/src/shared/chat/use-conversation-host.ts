import { useEffect } from 'react';

import { useConvRoom } from '../socket/use-conv-room.js';
import { acquireOpenConversation } from './open-conversation.js';

/**
 * Хост ленты беседы (лента, тред, заметки, «Новости» — в мессенджере,
 * карточке задачи, письма, сотрудника): беседа «открыта» для гейта
 * уведомлений (#124/#300) И подписана на свою WS-комнату (#351) — без
 * комнаты не доходят прочтения (галочки отправителя), «печатает…»,
 * реакции, закрепы. Оба реестра со счётчиком хостов: уход одного хоста не
 * гасит другой. Каждый новый хост ленты обязан вызывать этот хук.
 */
export function useConversationHost(conversationId: string | null | undefined): void {
  useEffect(
    () => (conversationId ? acquireOpenConversation(conversationId) : undefined),
    [conversationId],
  );
  useConvRoom(conversationId);
}
