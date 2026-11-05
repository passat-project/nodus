import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { OpenLetterEvent } from '@nodus/contracts';

import { api } from '../api-client.js';
import { enqueueSend } from '../chat/send-queue.js';
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
    // Трэд в событии (попап об ответе в трэде, #300) — открывается окном
    // трэда через готовый deep-link `?thread=`; функциональная форма search
    // сохраняет посторонние параметры (стек карточек ?cards=).
    (conversationId: string, threadRootId?: string | null) => {
      void navigate({
        to: '/chat/$conversationId',
        params: { conversationId },
        search: (prev) => ({ ...prev, thread: threadRootId ?? undefined }),
      });
    },
    [navigate],
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
      // «Открыть» из попапа и deep link nodus://chat/<id>; трэд — окном трэда.
      onOpenConversation: ({ conversationId, threadRootId }) =>
        openConversation(conversationId, threadRootId ?? null),
      // Клик по попапу «Поступило письмо» (#618): карточка письма поверх
      // текущего раздела — тем же стеком, что клик по уведомлению журнала.
      onOpenLetter: handlers.onOpenLetter,
    });
  }, [queryClient, openConversation, handlers.onOpenLetter]);
}
