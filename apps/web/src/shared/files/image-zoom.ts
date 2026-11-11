/**
 * Масштаб и панорамирование просмотрщика изображений (#721): ЧИСТЫЕ функции
 * без DOM — пределы, шаги, клампы, зум «в точку». Геометрию меряет и жесты
 * ловит хук (`use-image-zoom.ts`), панель — общий примитив с PDF
 * (`viewer-zoom-bar.tsx`), поэтому числа и остановки живут здесь.
 *
 * Масштаб — доля НАТУРАЛЬНОГО размера картинки (1 = 100%, пиксель в пиксель).
 * «По размеру окна» — не константа, а вычисляемый масштаб вписывания: он
 * может быть и меньше нижнего предела кнопок (огромное фото на узкой панели),
 * поэтому пределы 25–400% клампят действия пользователя, а не вписывание.
 */

/** Пределы масштаба для кнопок/колеса/жестов (доли натурального размера). */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** Остановки кнопок «−/+» (грамматика PDF-панели: шаги, а не произвольные числа). */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

/** Чувствительность Ctrl+колеса/пинча тачпада: доля масштаба на единицу deltaY. */
const WHEEL_ZOOM_RATE = 0.0015;

/** Потолок ширины вписывания `fit="width"` (скан письма, #55) — как было. */
export const MAX_FIT_WIDTH = 1200;

const EPSILON = 0.001;

/** Сдвиг панорамы картинки в CSS-пикселях от центра окна. */
export interface Offset {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const CENTER: Offset = { x: 0, y: 0 };

/** Масштаб в пределах 25–400%; мусор на входе (NaN/Infinity) — 100%. */
export function clampZoom(zoom: number): number {
  const value = Number.isFinite(zoom) ? zoom : 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** Следующая остановка «+»; в самом верху — без изменений. */
export function nextZoom(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + EPSILON) ?? Math.max(zoom, MAX_ZOOM);
}

/** Предыдущая остановка «−»; в самом низу — без изменений. */
export function prevZoom(zoom: number): number {
  return (
    [...ZOOM_STEPS].reverse().find((step) => step < zoom - EPSILON) ?? Math.min(zoom, MIN_ZOOM)
  );
}

/**
 * Масштаб «по размеру окна»: вписать целиком, мелкое — не растягивать.
 * `factor` — доля окна под картинку: лайтбокс чата оставляет поля (0.85),
 * файловый просмотрщик использует окно целиком.
 */
export function fitZoom(image: Size, viewport: Size, factor = 1): number {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }
  return Math.min(
    1,
    (viewport.width * factor) / image.width,
    (viewport.height * factor) / image.height,
  );
}

/** Масштаб «по ширине панели» (`fit="width"`: страница, скан письма). */
export function widthFitZoom(imageWidth: number, viewportWidth: number): number {
  if (imageWidth <= 0 || viewportWidth <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.min(viewportWidth, MAX_FIT_WIDTH) / imageWidth);
}

/**
 * Предел панорамы: половина переполнения по каждой оси — край картинки
 * не может уехать внутрь окна. Вписанная картинка не двигается вовсе (0).
 */
export function panBounds(image: Size, zoom: number, viewport: Size): Offset {
  return {
    x: Math.max(0, (image.width * zoom - viewport.width) / 2),
    y: Math.max(0, (image.height * zoom - viewport.height) / 2),
  };
}

/** Симметричный кламп сдвига по пределам панорамы. */
export function clampPan(pan: Offset, bounds: Offset): Offset {
  return {
    x: Math.min(bounds.x, Math.max(-bounds.x, pan.x)),
    y: Math.min(bounds.y, Math.max(-bounds.y, pan.y)),
  };
}

/**
 * Сдвиг панорамы при зуме «в точку» (`point` — координаты курсора/середины
 * пальцев относительно центра окна): точка контента под курсором остаётся
 * на месте, остальное масштабируется вокруг неё.
 */
export function zoomAtPoint(pan: Offset, point: Offset, from: number, to: number): Offset {
  if (from <= 0) return pan;
  const ratio = to / from;
  return {
    x: point.x - (point.x - pan.x) * ratio,
    y: point.y - (point.y - pan.y) * ratio,
  };
}

/**
 * Двойной клик: «по размеру окна» ↔ 100%. Из промежуточного масштаба — к
 * вписыванию; когда 100% и есть вписывание (мелкая картинка) — двукратное
 * увеличение, иначе жест не давал бы видимого отклика.
 */
export function toggleZoom(zoom: number, fit: number, epsilon = 0.01): number {
  if (Math.abs(zoom - fit) > epsilon) return fit;
  return Math.abs(fit - 1) <= epsilon ? clampZoom(fit * 2) : 1;
}

/** Ctrl/⌘+колесо и пинч тачпада: экспоненциальный шаг по deltaY. */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-deltaY * WHEEL_ZOOM_RATE));
}

/** Процент для панели (целые — «125%», а не «124.99999%»). */
export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}
