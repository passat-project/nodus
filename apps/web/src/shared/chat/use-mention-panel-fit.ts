import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Геометрия панели @упоминаний (#844): ОДНА логика для композера и окна
 * вложений. Панель — до 9 рядов (9 × 40px = 360px) и прокрутка внутри, если
 * кандидатов больше (мировая практика комбобоксов: 300–360px/8–10 рядов —
 * Persona DS 300px ≈ 10 рядов, типовой комбобокс 320px/36px = 9 рядов,
 * Expensify: 20 кандидатов, 5 видимых + скролл; Strapi поднимал панель с
 * 240px как «слишком мелкую»).
 *
 * В окне вложений панель раньше была absolute внутри DialogContent с
 * overflow — она обрезалась верхней границей окна и сжималась до 2–3 рядов.
 * Поэтому панель живёт В ПОРТАЛЕ (body, position: fixed) и НЕ подчиняется
 * клипу контейнера: высота одна, место выбирается по вьюпорту правилами
 * flip/size/shift (вверх; если сверху совсем тесно — вниз; ширина по полю с
 * прижатием к краям на 8px).
 */

/** Потолок: 9 рядов по 40px — столько же видно в чате, ядро панели одно. */
export const MENTION_PANEL_MAX = 360;
/** Минимальная полезная высота — 1 ряд (ниже сжимать смысла нет). */
const PANEL_MIN = 40;
/** Зазор поле↔панель (прежний mb-1.5) и отступ от кромок вьюпорта. */
const PANEL_GAP = 6;
const EDGE = 8;
/** Ширина панели не больше поля и этой ширины (бывший max-w-105 = 420px). */
const PANEL_WIDTH_MAX = 420;
/** Сверху меньше — панель уезжает вниз, если снизу просторнее. */
const ABOVE_PREFERRED_MIN = 200;

export interface MentionPanelPlacement {
  side: 'above' | 'below';
  left: number;
  width: number;
  maxHeight: number;
  /** Для side=above — расстояние от низа вьюпорта до панели. */
  bottom?: number;
  /** Для side=below — верх панели. */
  top?: number;
}

/** Чистая геометрия панели над/под полем по вьюпорту (flip/size/shift). */
export function placeMentionPanel(
  anchor: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number },
): MentionPanelPlacement {
  const width = Math.min(anchor.width, PANEL_WIDTH_MAX, viewport.width - EDGE * 2);
  const left = Math.min(Math.max(anchor.left, EDGE), viewport.width - width - EDGE);
  const spaceAbove = anchor.top - EDGE - PANEL_GAP;
  const spaceBelow = viewport.height - anchor.bottom - EDGE - PANEL_GAP;
  // Поле обычно у нижней кромки (композер) — приоритет вверху; вниз — только
  // когда сверху меньше комфортного минимума и снизу заметно просторнее.
  const side = spaceAbove >= ABOVE_PREFERRED_MIN || spaceAbove >= spaceBelow ? 'above' : 'below';
  const space = side === 'above' ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(PANEL_MIN, Math.min(MENTION_PANEL_MAX, space));
  return side === 'above'
    ? { side, left, width, maxHeight, bottom: viewport.height - anchor.top + PANEL_GAP }
    : { side, left, width, maxHeight, top: anchor.bottom + PANEL_GAP };
}

/** Верхняя граница панели (для якоря scroll-подстройки активного ряда).
 *  pointer-events: auto — ОБЯЗАТЕЛЕН в окне вложений: модальный Radix Dialog
 *  ставит body.style.pointerEvents = 'none' (DismissableLayer), и портал в body
 *  без явного auto не получал бы ни клики, ни наведение, ни колесо. */
export function mentionPanelStyle(placement: MentionPanelPlacement | null): CSSProperties {
  const base: CSSProperties = { position: 'fixed', pointerEvents: 'auto' };
  if (!placement) return { ...base, visibility: 'hidden' };
  return {
    ...base,
    left: placement.left,
    width: placement.width,
    maxHeight: placement.maxHeight,
    ...(placement.side === 'above' ? { bottom: placement.bottom } : { top: placement.top }),
  };
}

/**
 * Привязка панели к полю: пересчёт на монтирование, ресайз поля (textarea
 * растёт), ресайз окна и скролл любого контейнера (fixed-координаты «уезжают»
 * вместе с якорем). Портал — обязанность панели, хук отдаёт style.
 */
export function useMentionPanelFit(anchorRef?: RefObject<HTMLElement | null>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MentionPanelPlacement | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    if (!anchor) return undefined;
    const measure = () => {
      setPlacement(
        placeMentionPanel(anchor.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    };
    measure();
    // jsdom в тестах ResizeObserver не даёт — замер от монтирования и ресайза.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(anchor);
    window.addEventListener('resize', measure);
    // capture: скролл не всплывает, а скроллит вложенный контейнер окна.
    window.addEventListener('scroll', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchorRef]);

  return { listRef, style: mentionPanelStyle(placement) };
}

/** Активный ряд — всегда в видимой области списка: ↑/↓ с заворотом уводили
 *  подсветку за границу панели, и выбор происходил «вслепую». */
export function scrollActiveMentionIntoView(list: HTMLElement | null, active: number): void {
  const option = list?.querySelectorAll<HTMLElement>('[role="option"]')[active];
  if (!list || !option) return;
  const listRect = list.getBoundingClientRect();
  const optionRect = option.getBoundingClientRect();
  if (optionRect.top < listRect.top) list.scrollTop -= listRect.top - optionRect.top;
  else if (optionRect.bottom > listRect.bottom)
    list.scrollTop += optionRect.bottom - listRect.bottom;
}
