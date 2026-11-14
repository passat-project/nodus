import { useEffect, useRef } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { NotificationSummary } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { notificationsKeys } from '../../../shared/notifications-keys.js';
import { useNotificationsToastStore } from './toast-store.js';

/** Ф4: пороги эскалации по паузам (вердикт 30.09, Iqbal CHI'08 — доставка
 *  на breakpoints снижает стоимость прерывания). */
export const IDLE_TRIGGER_MS = 30_000;
export const WAVE_COOLDOWN_MS = 5 * 60_000;

/** События пользовательской активности, сбрасывающие idle-таймер. */
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel'];

/**
 * Мягкая волна накопленного важного (#100): в момент паузы (idle ≥30 c или
 * смена раздела) — ОДИН сводный тост «Требуют внимания: N», не чаще раза в
 * 5 минут; без прерывания «внутри мысли» (модалок нет — вердикт 30.09).
 * Монтируется вместе с тост-хостом; счётчик — из кэша сводки (WS держит
 * свежим). Рост важного с прошлой волны — условие показа.
 */
export function usePauseEscalation(): void {
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const lastWaveAt = useRef(0);
  const lastWaveAttention = useRef(0);

  // Волна — тост стора «действий»-лэйна с важным счётчиком (переиспользуем
  // контейнер, семантика мягкая: без звука, авто-скрытие стандартное).
  const push = useNotificationsToastStore((s) => s.push);

  const fireWave = () => {
    const now = Date.now();
    if (now - lastWaveAt.current < WAVE_COOLDOWN_MS) return;
    const summary = queryClient.getQueryData<NotificationSummary>(notificationsKeys.summary());
    const attention = summary?.attention ?? 0;
    if (attention <= lastWaveAttention.current) return;
    const viewerId = useAuthStore.getState().user?.id;
    if (!viewerId) return;
    lastWaveAt.current = now;
    lastWaveAttention.current = attention;
    if (attention > 0) {
      push(
        {
          notificationId: `wave-${now}`,
          userId: viewerId,
          priority: 'medium',
          kind: 'action.assignment',
          sourceId: 'wave',
          conversationId: null,
          conversationTitle: null,
          messageId: null,
          threadRootId: null,
          preview: `${ui.notifications.toastActionsSummary}: ${attention}`,
          actorName: null,
        },
        0,
      );
    }
  };

  // Смена раздела — сразу мягкая волна (breakpoint навигации).
  const firstPath = useRef(true);
  const fireRef = useRef(fireWave);
  fireRef.current = fireWave;
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    fireRef.current();
  }, [pathname]);

  // Idle ≥30 с — волна (активность сбрасывает таймер).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      // fireRef — свежий колбэк каждого рендера (канон эффекта смены раздела
      // выше): таймер стреляет текущей волной, а не колбэшем первого рендера.
      timer = setTimeout(() => fireRef.current(), IDLE_TRIGGER_MS);
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, arm, { passive: true });
    }
    arm();
    return () => {
      if (timer) clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, arm);
      }
    };
  }, []);
}
