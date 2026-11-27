/**
 * Геометрия прокрутки доски подводом курсора к краю (#366, модель Битрикс24):
 * чистые функции без DOM — их проверяет unit-тест, хук только применяет.
 */

/** Ширина горячей зоны у края видимой области доски, px. */
export const EDGE_ZONE_PX = 48;
/** Пауза перед стартом: проход курсора мимо края доску не дёргает. */
export const EDGE_DELAY_MS = 200;
/** Скорость у внутренней границы зоны и у самого края, px/мс (≈250–1250 px/с). */
export const EDGE_MIN_SPEED = 0.25;
export const EDGE_MAX_SPEED = 1.25;
/** Порог drag-to-pan: меньший сдвиг — обычный клик по фону. */
export const PAN_THRESHOLD_PX = 4;

/** Маркер скроллера доски (`BoardScroller`): по нему autoScroll dnd-kit
 *  ограничен доской и её колонками — страница при переносе не едет. */
export const BOARD_SCROLLER_SELECTOR = '[data-board-scroller]';

export type EdgeSide = 'left' | 'right';

export interface ScrollRoom {
  left: boolean;
  right: boolean;
}

/** Есть ли куда листать в каждую сторону (1px — допуск дробного scrollLeft
 *  при масштабе интерфейса --ui-scale). */
export function scrollRoom(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): ScrollRoom {
  return {
    left: scrollLeft > 1,
    right: scrollLeft + clientWidth < scrollWidth - 1,
  };
}

/**
 * Курсор в горячей зоне? `depth` 0..1 — насколько глубоко к краю (1 — у самой
 * кромки). Зона стороны работает, только если в эту сторону есть куда
 * листать: у конца доски зона гаснет и не мешает крайней колонке.
 * `insetLeft` — ширина закреплённой слева колонки (px): левая горячая зона
 * начинается правее неё, иначе подвод курсора над неподвижной колонкой
 * листал бы таблицу (#1006).
 */
export function edgeHit(
  x: number,
  bounds: { left: number; right: number },
  room: ScrollRoom,
  zone = EDGE_ZONE_PX,
  insetLeft = 0,
): { side: EdgeSide; depth: number } | null {
  const width = bounds.right - bounds.left;
  // Узкая доска: зоны не должны съесть её целиком.
  const available = Math.max(0, width - insetLeft);
  const z = Math.min(zone, available / 4);
  if (z <= 0) return null;
  const fromLeft = x - (bounds.left + insetLeft);
  const fromRight = bounds.right - x;
  if (room.left && fromLeft >= 0 && fromLeft < z) {
    return { side: 'left', depth: 1 - fromLeft / z };
  }
  if (room.right && fromRight >= 0 && fromRight < z) {
    return { side: 'right', depth: 1 - fromRight / z };
  }
  return null;
}

/** Скорость по глубине: квадратичный разгон — у границы зоны доска ползёт
 *  (точное позиционирование), у кромки — быстро. */
export function edgeSpeed(depth: number): number {
  const d = Math.min(1, Math.max(0, depth));
  return EDGE_MIN_SPEED + (EDGE_MAX_SPEED - EDGE_MIN_SPEED) * d * d;
}
