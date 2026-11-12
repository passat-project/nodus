import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '../api-client.js';
import { isUserActive, subscribeAttention } from '../attention/attention-store.js';
import { isModalLayerOpen, subscribeModalLayers } from '../attention/modal-layers.js';
import { desktopDismissPopups, isDesktopShell } from '../desktop/desktop-bridge.js';
import { useSurfaceVisible } from '../lib/surface-visibility.js';
import { notificationsKeys } from '../notifications-keys.js';
import { isDomainMocked } from './api-mock-config.js';

/** Открыта карточка сущности (#252): её уведомления у пользователя прочитаны —
 *  журнал, бейдж и «Требуют внимания» гаснут (сервер эмитит notification.read,
 *  кэши ленты перечитываются штатным конвейером). Один вызов на открытие
 *  сущности; ошибки — тихо (гашение не критично).
 *
 *  Модель внимания (#770): «открыл» ≠ «смотрю». Гашение (и попапов оболочки —
 *  #618, модель Telegram unlinkHistory) происходит только когда карточка на
 *  видимой поверхности, а пользователь активен (окно на виду + ввод за 30 с).
 *  Карточка, открытая в фоне/под другой карточкой, уведомлений не съедает;
 *  вернулся и посмотрел — гасим (подписка на внимание).
 *
 *  Модальный слой (#809): карточка под просмотрщиком/окном тоже не «на виду» —
 *  открытие слоя отменяет гашение, закрытие возвращает право дочитать. */
export function useReadEntityNotifications(sourceType: 'task' | 'letter', sourceId: string) {
  const queryClient = useQueryClient();
  const surfaceVisible = useSurfaceVisible();
  // Одно гашение на открытие сущности: повторные переходы внимания и ререндеры
  // не плодят запросы (сервер идемпотентен, но лишний трафик не нужен).
  const readSourceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sourceId || sourceId.startsWith('temp-')) return;

    const maybeRead = (): void => {
      if (!surfaceVisible || !isUserActive() || isModalLayerOpen()) return;
      if (readSourceRef.current === sourceId) return;
      readSourceRef.current = sourceId;
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
    };

    maybeRead();
    const unsubAttention = subscribeAttention(maybeRead);
    const unsubLayers = subscribeModalLayers(maybeRead);
    return () => {
      unsubAttention();
      unsubLayers();
    };
  }, [queryClient, sourceType, sourceId, surfaceVisible]);
}
