import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

import {
  EDGE_DELAY_MS,
  EDGE_STEP_MS,
  PAN_THRESHOLD_PX,
  edgeHit,
  edgeSpeed,
  scrollRoom,
  type EdgeSide,
  type ScrollRoom,
} from '../../lib/board/edge-scroll.js';

/** Контролы шапок колонок («+», «⋯», инпут переименования): наведение на них
 *  у края доску не листает — меню крайней колонки не уезжает из-под курсора. */
const HEADER_CONTROL = 'header button, header input, header [role="button"]';
/** Всё интерактивное (карточки — кнопки, их тянет dnd-kit): тут drag-to-pan
 *  не начинается, только с «фона» доски и пустоты колонок. */
const INTERACTIVE =
  'button, a, input, textarea, select, [role="button"], [role="menuitem"], [contenteditable="true"]';

interface Pan {
  pointerId: number;
  startX: number;
  startLeft: number;
  active: boolean;
}

function clearLoop(loop: { timer: number; frame: number; step: number }) {
  window.clearTimeout(loop.timer);
  window.clearInterval(loop.step);
  cancelAnimationFrame(loop.frame);
  loop.timer = 0;
  loop.frame = 0;
  loop.step = 0;
}

const sameRoom = (a: ScrollRoom, b: ScrollRoom) => a.left === b.left && a.right === b.right;

/**
 * Горизонтальная навигация широкой доски (#366): (1) прокрутка подводом
 * курсора к краю — зона 48px, пауза 200мс, квадратичный разгон к кромке, стоп
 * при уходе курсора и у конца доски; prefers-reduced-motion — шагами по
 * колонке без плавности; (2) drag-to-pan фона зажатой левой кнопкой (Trello/
 * Miro). Только мышь: тач листает доску нативно. Перетаскивание карточки
 * сюда не относится — у края доску листает autoScroll dnd-kit (движок доски).
 * Покадровая прокрутка — императивно (scrollLeft в rAF), React рендерит
 * только смену флагов зон. Общая механика ВСЕХ широких списков (вердикт
 * владельца 25.10.2026: «везде, как в канбане»): таблицы журналов берут
 * только край (`pan: false` — фон строк кликабелен, заголовки тянутся).
 */
export function useBoardEdgeScroll(
  ref: RefObject<HTMLDivElement | null>,
  {
    pan: panEnabled = true,
    mounted = true,
    insetLeft = 0,
  }: {
    pan?: boolean;
    /** Контейнер смонтирован (таблица без скелета/пустого состояния):
     *  смена флага переподписывает слежение за прокруткой. */
    mounted?: boolean;
    /** Ширина закреплённой слева колонки, px: левая горячая зона начинается
     *  правее неё (#1006). По умолчанию 0 — остальные доски и журналы. */
    insetLeft?: number;
  } = {},
) {
  const [room, setRoom] = useState<ScrollRoom>({ left: false, right: false });
  const [hot, setHot] = useState<EdgeSide | null>(null);
  const [panning, setPanning] = useState(false);

  const hitRef = useRef<{ side: EdgeSide; depth: number } | null>(null);
  // Таймер паузы, кадр плавной прокрутки, интервал шагов (reduced-motion).
  const loopRef = useRef({ timer: 0, frame: 0, step: 0 });
  const panRef = useRef<Pan | null>(null);

  // Флаги «есть куда листать»: скролл, ресайз доски, смена набора колонок.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = scrollRoom(el.scrollLeft, el.clientWidth, el.scrollWidth);
      setRoom((prev) => (sameRoom(prev, next) ? prev : next));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const columns = new MutationObserver(update);
    columns.observe(el, { childList: true });
    return () => {
      el.removeEventListener('scroll', update);
      resize.disconnect();
      columns.disconnect();
    };
  }, [ref, mounted]);

  const stop = () => {
    clearLoop(loopRef.current);
    hitRef.current = null;
    setHot(null);
  };

  useEffect(() => {
    const loop = loopRef.current;
    return () => clearLoop(loop);
  }, []);

  const start = () => {
    const loop = loopRef.current;
    loop.timer = 0;
    const el = ref.current;
    if (!el || !hitRef.current) return;
    const canGo = (side: EdgeSide) =>
      scrollRoom(el.scrollLeft, el.clientWidth, el.scrollWidth)[side];

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const first = el.firstElementChild as HTMLElement | null;
      const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
      // Шаг — колонка с зазором; колонки ещё нет (0) — треть видимой области.
      const step = (first?.offsetWidth || el.clientWidth / 3) + gap;
      const tick = () => {
        const hit = hitRef.current;
        if (!hit || !canGo(hit.side)) return stop();
        el.scrollBy({ left: hit.side === 'left' ? -step : step, behavior: 'instant' });
      };
      tick();
      loop.step = window.setInterval(tick, EDGE_STEP_MS);
      return;
    }

    // Дробная позиция копится в переменной: scrollLeft снапается к
    // device-px, и медленный старт (≈4px/кадр при --ui-scale) терял бы шаги.
    let pos = el.scrollLeft;
    let last = performance.now();
    const frame = (now: number) => {
      const hit = hitRef.current;
      if (!hit || !canGo(hit.side)) return stop();
      const dt = Math.min(32, now - last);
      last = now;
      if (Math.abs(el.scrollLeft - pos) > 2) pos = el.scrollLeft;
      pos += (hit.side === 'left' ? -1 : 1) * edgeSpeed(hit.depth) * dt;
      el.scrollLeft = pos;
      loop.frame = requestAnimationFrame(frame);
    };
    loop.frame = requestAnimationFrame(frame);
  };

  const trackEdge = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const target = e.target as Element;
    if (!el || e.pointerType !== 'mouse' || e.buttons !== 0 || target.closest(HEADER_CONTROL)) {
      if (hitRef.current) stop();
      return;
    }
    const bounds = el.getBoundingClientRect();
    const hit = edgeHit(
      e.clientX,
      bounds,
      scrollRoom(el.scrollLeft, el.clientWidth, el.scrollWidth),
      undefined,
      insetLeft,
    );
    if (!hit) {
      if (hitRef.current) stop();
      return;
    }
    // Перескок курсора на другой край — отсчёт паузы заново.
    if (hitRef.current && hitRef.current.side !== hit.side) stop();
    if (!hitRef.current) setHot(hit.side);
    hitRef.current = hit;
    const loop = loopRef.current;
    if (!loop.timer && !loop.frame && !loop.step) {
      loop.timer = window.setTimeout(start, EDGE_DELAY_MS);
    }
  };

  const endPan = () => {
    const pan = panRef.current;
    panRef.current = null;
    if (pan?.active) {
      ref.current?.releasePointerCapture(pan.pointerId);
      setPanning(false);
    }
  };

  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      stop();
      const el = ref.current;
      if (!panEnabled || !el || e.button !== 0 || e.pointerType !== 'mouse') return;
      if ((e.target as Element).closest(INTERACTIVE)) return;
      panRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startLeft: el.scrollLeft,
        active: false,
      };
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      const el = ref.current;
      if (!pan || !el) return trackEdge(e);
      const dx = e.clientX - pan.startX;
      if (!pan.active) {
        if (Math.abs(dx) < PAN_THRESHOLD_PX) return;
        pan.active = true;
        el.setPointerCapture(pan.pointerId);
        window.getSelection()?.removeAllRanges();
        setPanning(true);
      }
      el.scrollLeft = pan.startLeft - dx;
    },
    onPointerUp: endPan,
    onPointerCancel: endPan,
    onLostPointerCapture: endPan,
    onPointerLeave: () => {
      if (hitRef.current) stop();
    },
  };

  return { room, hot, panning, handlers };
}
