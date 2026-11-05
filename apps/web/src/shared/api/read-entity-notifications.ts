import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '../api-client.js';
import { desktopDismissPopups, isDesktopShell } from '../desktop/desktop-bridge.js';
import { notificationsKeys } from '../notifications-keys.js';
import { isDomainMocked } from './api-mock-config.js';

/** Открыта карточка сущности (#252): её уведомления у пользователя
 *  прочитаны — журнал, бейдж и «Требуют внимания» гаснут (сервер эмитит
 *  notification.read, кэши ленты перечитываются штатным конвейером).
 *  Один вызов на открытие сущности; ошибки — тихо (гашение не критично).
 *  В десктоп-оболочке попапы этой сущности гасятся тоже (#618, модель
 *  Telegram unlinkHistory: открыл источник — его попапы не висят). */
export function useReadEntityNotifications(sourceType: 'task' | 'letter', sourceId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!sourceId || sourceId.startsWith('temp-')) return;
    if (isDesktopShell()) void desktopDismissPopups(sourceId);
    if (isDomainMocked('notifications')) return;
    void api<{ read: number }>('/notifications/read-by-source', {
      method: 'POST',
      body: { sourceType, sourceId },
    })
      .then((r) => {
        if (r.read > 0) void queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
      })
      .catch(() => {});
  }, [queryClient, sourceType, sourceId]);
}
