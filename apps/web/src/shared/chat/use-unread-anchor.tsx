import { useEffect, useRef, type RefObject } from 'react';

import type { ChatMessage } from '@nodus/contracts';

import { useFlashStore, useJumpStore } from './jump-store.js';
import { scrollMessageIntoView } from './scroll-jump.js';

/**
 * Якорь «открыть на первом непрочитанном» (раунд 3, паттерн Telegram
 * «open at first unread + divider»; раунд 4 — надёжность и координация):
 *
 * - Решение принимает decideOpenAnchor ПО готовности списка бесед (гейт в
 *   conversation-pane): холодный deep-link раньше молча открывался в конец,
 *   и авто-догон «прочитывал» хвост.
 * - Jump-цель («Переслано от»/цитата) ПОБЕЖДАЕТ якорь непрочитанных — иначе
 *   два механизма дёргают ленту по очереди («навигация с 3–4 попыток»).
 * - Прокрутка — ТОЛЬКО кламп-скролл scrollMessageIntoView (без scrollToMessage
 *   примитива: его align:start/center дорастит спейсер под контентом, когда
 *   цель в последнем экране — «огромный зазор» между пузырями и композером,
 *   вердикт раунда 4). Первые данные приходят на скелетоне: дефолтный «в
 *   конец» примитив применяет к скелетону и НЕ повторяет на данных, наш
 *   якорь срабатывает при данных — единственное видимое движение ленты.
 *
 * autoScroll включается только после якоря: пока пользователь не долистал
 * сам до низа, новые сообщения ленту не дёргают (модальный autoScroll
 * примитива: following-bottom включается фактом нахождения у низа).
 * Первое непрочитанное вне загруженного окна — остаёмся на дне
 * (дозагрузка истории назад — задел пагинации #117).
 */

/** Полоса над якорем: разделитель непрочитанных (и дата-чип при смене дня)
 *  остаются ВИДНЫ над первым непрочитанным, а не срезаются сгибом. */
const UNREAD_SCROLL_MARGIN = 48;

export function UnreadAnchor({
  items,
  isLoading,
  isFetching = false,
  anchorSeq,
  jump,
  viewportRef,
  onAnchored,
}: {
  items: readonly ChatMessage[];
  isLoading: boolean;
  /** Идёт рефеч (в т.ч. фоновый на устаревшем кэше): якорь ждёт ГОТОВЫЕ
   * данные, иначе фиксируется на старом окне и не находит непрочитанное,
   * приехавшее рефечем позже (#880 — клик по попапу не докручивал ленту). */
  isFetching?: boolean;
  /** Порог непрочитанности (myLastReadSeq); null — непрочитанных нет. */
  anchorSeq: number | null;
  /** Jump-цель открытия (победа над якорем непрочитанных, open-anchor.ts). */
  jump: { messageId: string; nonce: number } | null;
  /** Viewport ленты-хозяина (кламп-скролл идёт по нему). */
  viewportRef: RefObject<HTMLElement | null>;
  onAnchored: () => void;
}): null {
  const settled = useRef(false);

  useEffect(() => {
    // Ждём готовые данные: устаревший кэш (isLoading=false, isFetching=true)
    // не содержит нового сообщения — фиксация на нём теряла якорь (#880).
    if (settled.current || isLoading || isFetching) return;
    settled.current = true;
    const viewport = viewportRef.current;
    const scrollTo = (messageId: string, align: 'start' | 'center', margin?: number) => {
      const el = viewport?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(messageId)}"]`,
      );
      if (el && viewport) {
        scrollMessageIntoView(el, viewport, { align, margin });
        return true;
      }
      return false;
    };
    if (jump !== null) {
      // Цель в окне — запрос исполнен здесь (исполнитель прыжка молчит),
      // вспышка как у обычного прыжка. Цели нет — оставляем исполнителю:
      // он покажет тост «недоступно».
      if (scrollTo(jump.messageId, 'center')) {
        useJumpStore.getState().consume(jump.nonce);
        useFlashStore.getState().flash(jump.messageId);
      }
      onAnchored();
      return;
    }
    // Непрочитанные исчезли/неизвестны или лента пуста (прочитано с другого
    // устройства, вычищенные данные) — якоря нет, снимаем блокировку
    // autoScroll немедленно.
    if (anchorSeq === null || items.length === 0) {
      onAnchored();
      return;
    }
    const firstUnread = items.find((m) => m.seq > anchorSeq && !m.deletedAt);
    if (firstUnread) {
      scrollTo(firstUnread.id, 'start', UNREAD_SCROLL_MARGIN);
    }
    // Нет цели в окне — дефолт (низ) уже применён примитивом; якорь завершён.
    onAnchored();
  }, [items, isLoading, isFetching, anchorSeq, jump, viewportRef, onAnchored]);

  return null;
}
