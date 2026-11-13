import { ArrowDownIcon } from 'lucide-react';
import type { RefObject } from 'react';
import { ui } from '@nodus/contracts';
import { MessageScrollerButton } from '@nodus/ui/components/message-scroller';

import { isMessageFullyVisible, scrollMessageIntoView, scrollToEndSmooth } from './scroll-jump.js';

/**
 * Стрелка «вниз» ленты беседы (раунд 4, вердикты владельца): пока первое
 * непрочитанное НИЖЕ сгиба — ПЛАВНАЯ прокрутка к нему; первое непрочитанное
 * уже видно (дочитали до него или непрочитанных нет) — плавная прокрутка
 * в самый низ. Обе ветки — собственная анимация `scroll-jump` (#845): у
 * примитива встроенный скролл в конец мгновенный, из-за чего повторное
 * нажатие (плашка уже снята прочтением) телепортировало ленту. «Навигации
 * по одному сообщению вниз» НЕТ (вердикт раунда 4): один клик — одно
 * плавное движение к первой непрочитанной границе, следующий — в конец ленты.
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
 * preventDefault выключает встроенный мгновенный scrollToEnd примитива во
 * всех ветках — прокрутку в конец ведёт наша анимация.
 */
export function FeedScrollerButton({
  firstUnreadId = null,
  viewportRef,
  unreadCount = 0,
  onBeforeNavigate,
}: {
  /** Таргет стрелки без плашки (ленты каналов/тредов): id первого
   *  непрочитанного корня. В беседе цель берётся из DOM-якоря плашки. */
  firstUnreadId?: string | null;
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
        const viewport = viewportRef.current;
        // Цель — КЛЕТКА плашки (DOM-якорь после синка): плашка по построению
        // оказывается у верхней кромки, без рассинхрона с id сообщения.
        if (!viewport) return;
        const anchor = viewport.querySelector<HTMLElement>('[data-divider-for]');
        // Беседа: цель — клетка плашки (по построению у верхней кромки).
        // Канал/тред: плашки нет, цель — первый непрочитанный корень.
        const target =
          anchor ??
          (firstUnreadId
            ? viewport.querySelector<HTMLElement>(
                `[data-message-id="${CSS.escape(firstUnreadId)}"]`,
              )
            : null);
        // Границы нет или она уже видна — «в конец». ВСЕГДА своей плавной
        // анимацией: штатный скролл примитива мгновенный, и повторное
        // нажатие (плашка снята прочтением) телепортировало ленту (#845).
        if (!target || isMessageFullyVisible(target, viewport)) {
          event.preventDefault();
          scrollToEndSmooth(viewport);
          return;
        }
        event.preventDefault();
        scrollMessageIntoView(
          () =>
            viewport.querySelector<HTMLElement>(
              anchor
                ? '[data-divider-for]'
                : `[data-message-id="${CSS.escape(firstUnreadId ?? '')}"]`,
            ),
          viewport,
          {
            align: 'start',
            margin: anchor ? 8 : 48,
            behavior: 'smooth',
          },
        );
      }}
    >
      {content}
    </MessageScrollerButton>
  );
}
