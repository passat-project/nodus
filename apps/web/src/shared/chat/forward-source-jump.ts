import type { ChatMessage, ForwardedFrom } from '@nodus/contracts';

import { openCardViaBridge } from '../lib/card-bridge.js';
import type { ChatHostNavigation } from './chat-host.js';
import { useJumpStore } from './jump-store.js';

/**
 * Клик по «Переслано от» — к оригиналу (вердикт 25.09; общий для пузыря чата
 * и карточки поста канала, #1072): в мессенджере (страница/карточка)
 * навигация ВНУТРИ него — переключиться на беседу-источник/тред, слайдер не
 * открывается; в карточке слайдера это замена её содержимого. Чат карточки
 * сущности открывает мессенджер-карточку поверх (легитимная роль слайдера).
 * Далее jump-запрос подбирает лента целевой беседы (переживает навигацию).
 */
export function jumpToForwardSource(
  message: Pick<ChatMessage, 'conversationId' | 'forwardedFrom'>,
  host: ChatHostNavigation | null,
): void {
  const from: ForwardedFrom | null = message.forwardedFrom;
  if (!from) return;
  if (from.conversationId !== message.conversationId) {
    if (host) host.openConversation(from.conversationId, from.threadRootId);
    else openCardViaBridge({ kind: 'messenger', id: from.conversationId });
  }
  useJumpStore.getState().request(from.conversationId, from.messageId, from.threadRootId);
}
