import { BOARD_SCROLLER_SELECTOR } from './edge-scroll.js';

/**
 * FLIP-анимация живой перестановки канбан-борда (#737, фидбек владельца
 * 13.11.2026: «пропала красивая анимация»).
 *
 * Анимацию движения карточек раньше давала `verticalListSortingStrategy` —
 * та самая, что разворачивала сторону вставки (механизм — `board-sorting.ts`).
 * Возвращать стратегию нельзя. FLIP решает только визуальную задачу и НЕ
 * участвует в выборе места: он читает фактическую позицию карточки до и после
 * того, как борд уже переставился, и показывает временный сдвиг «старое место →
 * новое» (200 мс). Конечная позиция всегда — живой порядок борда, поэтому
 * инверсии стороны здесь взяться неоткуда.
 */

/** Позиция элемента в КОНТЕНТНЫХ координатах прокрутки: вертикаль — колонки
 *  (`[data-column-scroll]`), горизонталь — доски (`[data-board-scroller]`).
 *  Прокрутка, в том числе автоскролл при переносе, не меняет такую позицию —
 *  иначе каждый кадр автоскролла выглядел бы «движением» карточки. null —
 *  элемент вне контейнеров борда: анимировать нечего. */
export function contentPosition(el: HTMLElement): { top: number; left: number } | null {
  const column = el.closest<HTMLElement>('[data-column-scroll]');
  const board = el.closest<HTMLElement>(BOARD_SCROLLER_SELECTOR);
  if (!column && !board) return null;
  const rect = el.getBoundingClientRect();
  const columnRect = column?.getBoundingClientRect();
  const boardRect = board?.getBoundingClientRect();
  return {
    top: rect.top - (columnRect?.top ?? 0) + (column?.scrollTop ?? 0),
    left: rect.left - (boardRect?.left ?? 0) + (board?.scrollLeft ?? 0),
  };
}

/** Сдвиг меньше пикселя — не движение (субпиксельные пересчёты раскладки). */
export const FLIP_MIN_DELTA_PX = 1;

/** Сдвиг «старое место → новое» для FLIP-анимации; null — двигать нечего. */
export function flipDelta(
  prev: { top: number; left: number },
  next: { top: number; left: number },
): { dx: number; dy: number } | null {
  const dx = prev.left - next.left;
  const dy = prev.top - next.top;
  if (Math.abs(dx) < FLIP_MIN_DELTA_PX && Math.abs(dy) < FLIP_MIN_DELTA_PX) return null;
  return { dx, dy };
}
