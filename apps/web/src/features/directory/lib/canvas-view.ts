/**
 * Вид канваса структуры (#768): масштаб и панорама как в редакторе-контуре.
 * Чистые функции без DOM — тестируются отдельно: `transform` канваса —
 * translate(x, y) scale(zoom) с началом координат в левом верхнем углу.
 *
 * Поведение (вердикт владельца 13.11.2026): Ctrl/⌘+колесо — зум К КУРСОРУ
 * (пинч тачпада приходит тем же ctrl+wheel); колесо без Ctrl — панорама;
 * зажатая ЛКМ по пустому месту — перетаскивание полотна. Пределы 30–200%:
 * ниже структура нечитаема, выше карточки распухают.
 */

export interface CanvasView {
  /** Сдвиг полотна в экранных px. */
  x: number;
  y: number;
  /** Масштаб: 1 = 100%. */
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;

/** Чувствительность Ctrl+колеса: доля масштаба на единицу deltaY. */
const WHEEL_ZOOM_RATE = 0.0015;

export const INITIAL_VIEW: CanvasView = { x: 0, y: 0, zoom: 1 };

/** Масштаб в пределах 30–200%; мусор на входе (NaN/Infinity) — 100%. */
export function clampZoom(zoom: number): number {
  const value = Number.isFinite(zoom) ? zoom : 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** Сдвиг полотна. */
export function panBy(view: CanvasView, dx: number, dy: number): CanvasView {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/** Точка полотна под экранной точкой (в координатах вьюпорта). */
export function contentPointAt(view: CanvasView, point: Point): Point {
  const zoom = view.zoom || 1;
  return { x: (point.x - view.x) / zoom, y: (point.y - view.y) / zoom };
}

/** Новый вид при масштабе `nextZoom` с неподвижной точкой `point` (курсор). */
export function zoomAtPoint(view: CanvasView, nextZoom: number, point: Point): CanvasView {
  const zoom = clampZoom(nextZoom);
  if (zoom === view.zoom) return view;
  const anchor = contentPointAt(view, point);
  return { ...view, zoom, x: point.x - anchor.x * zoom, y: point.y - anchor.y * zoom };
}

/** Ctrl/⌘+колесо и пинч тачпада: экспоненциальный шаг к курсору. */
export function wheelZoomAt(view: CanvasView, deltaY: number, point: Point): CanvasView {
  return zoomAtPoint(view, view.zoom * Math.exp(-deltaY * WHEEL_ZOOM_RATE), point);
}

/**
 * Масштаб «показать целиком»: полотно вписывается в свободное место (без
 * увеличения сверх 100% — мелкая структура не должна раздуваться).
 */
export function fitZoom(content: Size, free: Size): number {
  if (content.width <= 0 || content.height <= 0 || free.width <= 0 || free.height <= 0) {
    return 1;
  }
  return clampZoom(Math.min(free.width / content.width, free.height / content.height, 1));
}

/**
 * Сдвиг вида, при котором точка полотна `point` встаёт в центр `free`-области
 * вьюпорта. `point` — экранные координаты текущей отрисовки (после масштаба),
 * поэтому дельта применяется напрямую к translate.
 */
export function centerAtPoint(view: CanvasView, point: Point, free: Size): CanvasView {
  return {
    ...view,
    x: view.x + free.width / 2 - point.x,
    y: view.y + free.height / 2 - point.y,
  };
}
