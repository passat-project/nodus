import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { registerNotificationSink } from '../../../shared/socket/notification-bridge.js';
import { notificationsKeys } from '../../../shared/notifications-keys.js';
import { isDesktopShell } from '../../../shared/desktop/desktop-bridge.js';
import { notifyDesktopLetter } from '../../../shared/desktop/letter-popup.js';
import { useNotificationsToastStore } from './toast-store.js';

/**
 * Приём живых будил журнала (#100): монтируется в AppShell (пока живой
 * сокет), регистрирует мост shared→фича: тосты по ярусу + инвалидация
 * сводки/ленты (сервер — истина). Размонтирование снимает синк тихо.
 *
 * В десктоп-оболочке внутренний тост НЕ всплывает (фидбек владельца 08.10):
 * всплывающий канал там один — попапы оболочки (ADR-0019), иначе каждое
 * сообщение звенело дважды. Почта — исключение в ту же сторону (#618):
 * попапов чата у письма нет, журнал живёт в колокольчике, счётчики — в бейдже.
 */
export function useNotificationSink(): void {
  const queryClient = useQueryClient();
  const push = useNotificationsToastStore((s) => s.push);

  useEffect(() => {
    registerNotificationSink({
      dispatched: (snapshot, attempt) => {
        if (isDesktopShell()) {
          notifyDesktopLetter(snapshot);
        } else {
          push(snapshot, attempt);
        }
        void queryClient.invalidateQueries({ queryKey: notificationsKeys.summary() });
        void queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
      },
      read: () => {
        void queryClient.invalidateQueries({ queryKey: notificationsKeys.summary() });
      },
    });
    return () => registerNotificationSink(null);
  }, [push, queryClient]);
}
