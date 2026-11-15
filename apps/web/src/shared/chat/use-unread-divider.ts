import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@nodus/contracts';

import { effectiveReadSeq, findFirstUnreadId } from './unread-divider.js';

/**
 * Плашка «Непрочитанные сообщения» (#845).
 *
 * В ПОКОЕ плашка статична: она не двигается от прочтения, входящих и своей
 * отправки — поэтому лента не дёргается. Живая граница (первый непрочитанный
 * по максимуму серверного и локального знаков) считается постоянно, но
 * переставляется плашка ТОЛЬКО в замаскированный момент — при навигации
 * кнопкой «вниз», когда лента плавно едет и вставка/удаление строки
 * незаметны (`syncToLive`, вызывает `conversation-pane` через `flushSync`).
 * К концу анимации плашка уже стоит на новом месте, и раскладка не меняется.
 *
 * На открытии диалога граница снимается по серверному знаку на момент маунта
 * (та же точка, что у якоря ленты): если читать нечего — плашки нет.
 * Модель-эталон: Telegram `UnreadBar` (флаг `freezed`) и его кнопка «вниз».
 */
export function useUnreadDivider({
  items,
  unreadCount,
  serverReadSeq,
  localReadSeq,
  meId,
}: {
  items: readonly ChatMessage[];
  /** `unreadCount` беседы: сервер — судья «есть ли что читать». */
  unreadCount: number;
  /** `myLastReadSeq` списка бесед (живой, отстаёт от квитанций). */
  serverReadSeq: number | null;
  /** Локальный знак прочтения ленты (`useLocalReadSeq`) — снимает отставание. */
  localReadSeq: number | null;
  /** Автор своих сообщений: они границей не бывают. */
  meId?: string;
}): {
  /** id сообщения, над которым стоит плашка; null — плашки нет. */
  dividerId: string | null;
  /** Снимок `myLastReadSeq` на маунте — порог якоря открытия. */
  openReadSeq: number | null;
  /** Переставить плашку на ЖИВУЮ границу — только в момент анимации
   *  прокрутки (кнопка «вниз»); движение маскируется движением ленты.
   *  Возвращает id, на который встала плашка, — стрелка летит ровно туда же. */
  syncToLive: () => string | null;
} {
  // Снимок открытия: по нему ставится стартовая плашка (и якорь ленты).
  const [openMeta] = useState(() => ({ hadUnread: unreadCount > 0, readSeq: serverReadSeq }));
  const openLiveId = useMemo(
    () => (openMeta.hadUnread ? findFirstUnreadId(items, openMeta.readSeq, meId) : null),
    [items, openMeta, meId],
  );
  const [dividerId, setDividerId] = useState<string | null>(null);
  // Стартовая плашка — один раз, как только целевое сообщение попало в
  // загруженное окно (история может догрузиться после маунта). Флаг важен:
  // после syncToLive в null эффект не должен «воскресить» стартовую границу.
  const seededRef = useRef(false);
  useLayoutEffect(() => {
    if (seededRef.current) return;
    if (dividerId === null && openLiveId === null) return;
    seededRef.current = true;
    if (dividerId === null) setDividerId(openLiveId);
  }, [dividerId, openLiveId]);

  // Живая граница: обновляется постоянно, но в DOM попадает только по
  // syncToLive — в момент, когда её перестановку скрывает анимация.
  const liveId = useMemo(() => {
    if (unreadCount <= 0) return null;
    return findFirstUnreadId(items, effectiveReadSeq(serverReadSeq, localReadSeq), meId);
  }, [items, unreadCount, serverReadSeq, localReadSeq, meId]);
  const liveRef = useRef(liveId);
  liveRef.current = liveId;
  const syncToLive = useCallback((): string | null => {
    const target = liveRef.current;
    setDividerId(target);
    return target;
  }, []);

  return { dividerId, openReadSeq: openMeta.readSeq, syncToLive };
}
