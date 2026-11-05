import type { NotificationSnapshot } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { desktopFlashTaskbar, desktopShowPopup, isDesktopShell } from './desktop-bridge.js';

/**
 * Попап оболочки о почте (#618, В4: «по каждому новому письму… не хуже
 * аутлука»): событие журнала `letter.arrived` в десктоп-оболочке поднимает
 * попап с темой письма; клик открывает карточку (open-letter), ответа из
 * попапа нет (canReply=false — письмо не чат). Правила тишины чата не
 * применяются: «смотрю в источник» для почты нет, каждое письмо звенит.
 * Мягкое мигание таскбара (не urgent — критичный режим не нужен).
 */
export function notifyDesktopLetter(snapshot: NotificationSnapshot): void {
  if (!isDesktopShell()) return;
  if (snapshot.kind !== 'letter.arrived') return;
  const meId = useAuthStore.getState().user?.id ?? null;
  if (meId === null || snapshot.userId !== meId) return; // чужие будила
  void desktopShowPopup({
    id: snapshot.notificationId,
    letterId: snapshot.sourceId,
    title: ui.notifications.kindTitles['letter.arrived'],
    preview: (snapshot.preview ?? '').slice(0, 500),
    urgent: false,
    canReply: false,
  });
  void desktopFlashTaskbar(false);
}
