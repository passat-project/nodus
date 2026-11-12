/**
 * FLIP-анимация живой перестановки канбан-борда (#737).
 *
 * Анимацию движения карточек раньше давала `verticalListSortingStrategy` —
 * та самая, что разворачивала сторону вставки (механизм — `board-sorting.ts`).
 * Возвращать стратегию нельзя. FLIP решает только визуальную задачу и НЕ
 * участвует в выборе места: он читает фактическую позицию карточки до и после
 * того, как борд уже переставился, и показывает временный сдвиг «старое место →
 * новое» (200 мс). Конечная позиция всегда — живой порядок борда.
 */

/** Позиция элемента в РАСКЛАДКЕ — без CSS-трансформов. `offsetTop`/`offsetLeft`
 *  считаются от offsetParent по layout-боксам и не включают FLIP-анимацию
 *  (CSSOM: offset* — геометрия раскладки, transforms её не меняют).
 *
 *  Это принципиально: dnd-kit перерисовывает карточки на КАЖДОЕ движение
 *  указателя, а замер по `getBoundingClientRect` попадает внутрь бегущей
 *  анимации — «позиция до» каждый кадр съезжает, FLIP перезапускает сам себя,
 *  и призрак дико вибрирует (репро владельца 13.11.2026). Layout-позиция
 *  стабильна, пока реально не изменился порядок/раскладка: анимация не может
 *  раскачать собственный замер. */
export function layoutPosition(el: HTMLElement): { top: number; left: number } {
  return { top: el.offsetTop, left: el.offsetLeft };
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
