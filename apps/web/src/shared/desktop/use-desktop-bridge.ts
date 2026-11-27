import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { OpenLetterEvent } from '@nodus/contracts';

import { api } from '../api-client.js';
import { cachedConversation } from '../chat/chat-queries.js';
import { chatConversationUrl } from '../chat/messenger-nav.js';
import { requestMessageJump } from '../chat/jump-store.js';
import { enqueueSend } from '../chat/send-queue.js';
import { openOrFocusTab } from '../lib/tab-bridge.js';
import { bindDesktopShellEvents, isDesktopShell } from './desktop-bridge.js';

/**
 * Хост моста оболочки (монтируется в app-shell рядом с useUnreadTitle):
 * слушает события «оболочка → веб» и сигналит готовность (shellReady —
 * оболочка доставляет отложенный deep link только после него). Открытие
 * письма из попапа (#618) — колбэк app-слоя (стек карточек): shared не
 * импортирует app (направление слоёв).
 */
export function useDesktopBridge(handlers: {
  /** Клик по попапу «Поступило письмо»: открыть карточку письма. */
  onOpenLetter: (payload: OpenLetterEvent) => void;
}): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const openConversation = useCallback(
    // Вкладки браузерного типа (#1038): своя /chat-вкладка активируется,
    // нет — открывается новая (мост-порт openOrFocusTab). Роутер ведёт МОСТ:
    // navigate по адресу — контроллер запишет переход в активную вкладку.
    // Трэд в событии (попап об ответе в трэде, #300) — окном трэда через
    // deep-link `?thread=`. Сообщение-причина (#1072) — прыжок к нему:
    // лента/тред докрутят и подсветят; пока сообщение за сгибом, квитанция
    // чтения не уходила и счётчик висел. Вкладка по типу беседы сразу в
    // адресе (#1062): попап оболочки и `nodus://chat/<id>` не оставляют
    // пользователя на «Чатах» с пустым левым списком. Тип неизвестен
    // (беседы нет в кэше) — страница выведет его сама после deep-link-поиска.
    (conversationId: string, threadRootId?: string | null, messageId?: string | null) => {
      const conversation = cachedConversation(queryClient, conversationId);
      const url = chatConversationUrl(conversationId, {
        type: conversation?.type,
        threadRootId,
      });
      openOrFocusTab(url, '/chat');
      void navigate({ href: url });
      if (messageId) requestMessageJump(conversationId, messageId, threadRootId ?? null);
    },
    [navigate, queryClient],
  );

  useEffect(() => {
    if (!isDesktopShell()) return;
    return bindDesktopShellEvents({
      // Быстрый ответ из попапа: прямая отправка через очередь беседы
      // (серриализация #243, идемпотентность #48); сбой — открыть беседу,
      // чтобы пользователь повторил в композере.
      onPopupReply: ({ conversationId, text }) => {
        const tempId = crypto.randomUUID();
        enqueueSend(conversationId, () =>
          api(`/chat/conversations/${conversationId}/messages`, {
            method: 'POST',
            idempotencyKey: tempId,
            // Optional-поля не шлём вовсе: серверная zod-схема ждёт
            // отсутствующий ключ (undefined), а не null (400, как у хука).
            body: {
              text,
              urgent: false,
            },
          }),
        )
          .then(() => undefined)
          .catch(() => openConversation(conversationId));
      },
      // «Открыть» из попапа и deep link nodus://chat/<id>; трэд — окном трэда;
      // messageId попапа — прыжок к сообщению-причине (#1072).
      onOpenConversation: ({ conversationId, threadRootId, messageId }) =>
        openConversation(conversationId, threadRootId ?? null, messageId ?? null),
      // Клик по попапу «Поступило письмо» (#618): карточка письма поверх
      // текущего раздела — тем же стеком, что клик по уведомлению журнала.
      onOpenLetter: handlers.onOpenLetter,
    });
  }, [queryClient, openConversation, handlers.onOpenLetter]);
}
