import { ArrowDownIcon } from 'lucide-react';
import type { RefObject } from 'react';
import { ui } from '@nodus/contracts';
import { MessageScrollerButton } from '@nodus/ui/components/message-scroller';

import { scrollMessageIntoView } from './scroll-jump.js';

/**
 * Стрелка «вниз» ленты беседы (раунд 4, вердикты владельца): пока первое
 * непрочитанное НИЖЕ сгиба — ПЛАВНАЯ (smooth, «красивая прокрутка», не
 * телепорт) прокрутка к нему; первое непрочитанное уже видно (дочитали до
 * него или непрочитанных нет) — штатное поведение примитива: плавный скролл
 * в самый низ. «Навигации по одному сообщению вниз» НЕТ (вердикт
 * раунда 4): один клик — одно плавное движение к первой непрочитанной
 * границе, следующий — в конец ленты.
 *
 * #132: чип-счётчик НЕпрочитанных на кнопке (модель Telegram): новые
 * сообщения копятся, пока читатель в истории; цифра гаснет с прочтением.
 * Канон счётчиков — моно 11px tabular-nums.
 * #236 (вердикт 07.10): заливка — ЦВЕТ СВОЕГО ПУЗЫРЯ (bubble-out), текст —
 * foreground пузыря: в тёмной теме синий+белый как в Telegram, в светлой —
 * читаемая пара своего пузыря (тон всей меты на пузыре, #127). Размер —
 * literal px, не rem-классы: при ui-scale 1.25 бейдж раздувало (h-4 = 20px
 * фактических). Раунд 2 вердикта 07.10: бейдж ПО ЦЕНТРУ кнопки; цифровая
 * оптическая компенсация — измеренная пиксельным сканом (канон #143:
 * каркас шрифта центрируется браузером, не «чернила» — у JetBrains Mono
 * резерв над базовой линией больше).
 *
 * preventDefault выключает встроенный scrollToEnd кнопки примитива только
 * в ветке «к первому непрочитанному».
 */
export function FeedScrollerButton({
  firstUnreadId,
  viewportRef,
  unreadCount = 0,
  onBeforeNavigate,
}: {
  firstUnreadId: string | null;
  viewportRef: RefObject<HTMLElement | null>;
  unreadCount?: number;
  /** Перед навигацией (к первому непрочитанному или в конец): плашка
   *  непрочитанных переставляется на живую границу — её движение скрывает
   *  начинающаяся анимация прокрутки (#845). Цель скролла берётся из DOM-якоря
   *  самой плашки (`data-divider-for`), поэтому рассинхрона быть не может. */
  onBeforeNavigate?: () => void;
}) {
  const content = (
    <>
      <ArrowDownIcon />
      <span className="sr-only">{ui.chat.scrollToUnread}</span>
      {unreadCount > 0 ? (
        <span
          data-slot="feed-unread-badge"
          className="absolute left-1/2 top-0 z-10 flex h-[17px] min-w-[17px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-bubble-out px-[4px] font-mono text-[11px] leading-none font-semibold text-bubble-out-foreground tabular-nums"
        >
          <span data-slot="feed-unread-badge-digit" className="translate-y-[0.5px]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        </span>
      ) : null}
    </>
  );
  return (
    <MessageScrollerButton
      onClick={(event) => {
        onBeforeNavigate?.();
        // Цель — ровно та, над которой стоит плашка (DOM-якорь после синка);
        // нет плашки — непрочитанных нет, штатный скролл в конец.
        const viewport = viewportRef.current;
        const anchor =
          viewport?.querySelector<HTMLElement>('[data-divider-for]')?.dataset.dividerFor ?? null;
        const targetId = anchor ?? firstUnreadId;
        if (targetId === null) return;
        const el = viewport?.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(targetId)}"]`,
        );
        const vr = viewport?.getBoundingClientRect();
        const er = el?.getBoundingClientRect();
        // Первое непрочитанное уже ПОЛНОСТЬЮ видно — граница достигнута:
        // штатный плавный скролл в конец ленты.
        const alreadyAtUnread =
          el && vr && er && er.top >= vr.top - 1 && er.bottom <= vr.bottom + 1;
        if (alreadyAtUnread || !el || !viewport) return; // без preventDefault
        event.preventDefault();
        scrollMessageIntoView(el, viewport, {
          align: 'start',
          margin: 48,
          behavior: 'smooth',
        });
      }}
    >
      {content}
    </MessageScrollerButton>
  );
}
