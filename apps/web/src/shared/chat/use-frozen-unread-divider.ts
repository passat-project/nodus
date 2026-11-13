import { useLayoutEffect, useMemo, useState } from 'react';
import type { ChatMessage } from '@nodus/contracts';

import { findFirstUnreadId } from './unread-divider.js';

/**
 * Замороженная граница «Непрочитанные сообщения» (#845, модель Telegram
 * `UnreadBar::freezed`).
 *
 * Граница снимается ОДИН раз на открытии диалога — над первым непрочитанным
 * по серверному `myLastReadSeq` и `unreadCount` на момент маунта — и дальше
 * НЕ пересчитывается: плашка живёт в ленте, пока открыт диалог. Прочтение её
 * не двигает и не снимает (она уходит вверх вместе с историей), новые
 * сообщения открытого чата новую не создают.
 *
 * Почему не живой watermark, как было раньше: серверный снимок списка бесед
 * отстаёт от квитанций (троттл 500 мс + медленный рефеч и гонки), и плашка
 * на мгновение «воскресала» над уже прочитанным — вставка строки толкала
 * ленту вверх, удаление возвращало вниз (жалоба владельца). Замороженная
 * граница не может ни появиться, ни сдвинуться без перезахода в диалог.
 *
 * При следующем входе хук монтируется заново: если читать уже нечего
 * (`unreadCount = 0`), границы нет.
 */
export function useFrozenUnreadDivider({
  items,
  unreadCount,
  readSeq,
  meId,
}: {
  items: readonly ChatMessage[];
  /** `unreadCount` беседы на момент открытия (сервер — судья «есть ли что
   *  читать»); в ленте он может жить дальше своей жизнью. */
  unreadCount: number;
  /** `myLastReadSeq` на момент открытия — та же точка, что у якоря ленты. */
  readSeq: number | null;
  /** Автор своих сообщений: они границей не бывают. */
  meId?: string;
}): {
  /** id сообщения, над которым стоит плашка; null — плашки нет. */
  dividerId: string | null;
  /** Снимок `myLastReadSeq` на маунте — порог якоря открытия (лента встаёт
   *  на первое непрочитанное ровно по той же точке, что и плашка). */
  openReadSeq: number | null;
} {
  // Снимок открытия: живые значения после маунта не важны (заморозка).
  const [openMeta] = useState(() => ({ hadUnread: unreadCount > 0, readSeq }));
  const liveId = useMemo(
    () => (openMeta.hadUnread ? findFirstUnreadId(items, openMeta.readSeq, meId) : null),
    [items, openMeta, meId],
  );
  const [frozenId, setFrozenId] = useState<string | null>(null);
  // Первое появление целевого сообщения в загруженном окне (история может
  // догрузиться после маунта) — фиксируем и больше не трогаем.
  useLayoutEffect(() => {
    if (frozenId === null && liveId !== null) setFrozenId(liveId);
  }, [frozenId, liveId]);
  return { dividerId: frozenId, openReadSeq: openMeta.readSeq };
}
