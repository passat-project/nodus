// Файл осознанно 300–400 строк (I5): один хук держит ВСЁ состояние просмотра —
// масштаб, панораму (клампы — в `image-zoom.ts`), жесты (кнопки, колесо,
// пинч, drag), клавиши и пересчёт «по размеру» при ресайзе. Разнесение по
// файлам разорвало бы общие refs кадра и обработчики указателя (pointerdown →
// move → up живут в одном жизненном цикле), поэтому ответственность одна —
// «состояние и жесты зума», а чистые формулы вынесены отдельно.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  CENTER,
  clampPan,
  clampZoom,
  fitZoom,
  nextZoom,
  panBounds,
  prevZoom,
  toggleZoom,
  wheelZoom,
  widthFitZoom,
  zoomAtPoint,
  zoomPercent,
  type Offset,
  type Size,
} from './image-zoom.js';

/** Шаг сдвига стрелками клавиатуры (CSS-пиксели; панорама без мыши). */
const KEY_PAN_STEP = 48;

/** Ещё не загруженная картинка: габаритов нет. */
const ZERO: Size = { width: 0, height: 0 };

const distance = (a: Offset, b: Offset) => Math.hypot(a.x - b.x, a.y - b.y) || 1;

/** Первая пара активных указателей (пинч); одного пальца недостаточно. */
function firstTwo(pointers: Map<number, Offset>): [Offset, Offset] | null {
  const [a, b] = [...pointers.values()];
  return a && b ? [a, b] : null;
}

/** Координаты события относительно ЦЕНТРА окна — база зума «в точку». */
function pointIn(area: HTMLElement, clientX: number, clientY: number): Offset {
  const rect = area.getBoundingClientRect();
  return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
}

/**
 * Зум и панорамирование изображения (#721): состояние «по размеру окна»
 * (`zoom === null` — следует за ресайзом панели) либо явный масштаб от
 * кнопок/колеса/жестов. Панорама — сдвиг от центра, всегда клампится по
 * переполнению, поэтому картинка не уезжает за окно.
 *
 * `fitFactor` — доля окна под вписанную картинку (лайтбокс чата оставляет
 * поля), `resetKey` — смена картинки: масштаб, сдвиг и натуральный размер
 * начинаются заново (листание галереи не наследует зум прошлого кадра).
 *
 * Жесты: `Ctrl`/`⌘`+колесо и пинч тачпада (Windows-тачпад шлёт его тем же
 * ctrl+wheel), колесо без модификатора — сдвиг, перетаскивание мышью/пальцем,
 * два пальца — пинч, двойной клик — «по размеру» ↔ 100%, клавиши `+`/`−`/`0`
 * и стрелки (работают только при фокусе в области просмотра).
 */
export interface ImageZoomOptions {
  /** Вписывание по ширине панели (`fit="width"`: скан письма). */
  fit?: 'width';
  /** Доля окна под вписанную картинку (1 — целиком, лайтбокс — 0.85). */
  fitFactor?: number;
  /** Смена картинки (id/url): состояние масштаба начинается заново. */
  resetKey?: string | number;
}

export function useImageZoom({ fit, fitFactor = 1, resetKey }: ImageZoomOptions = {}) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<Size>(ZERO);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoomState] = useState<number | null>(null);
  const [pan, setPan] = useState<Offset>(CENTER);
  const [dragging, setDragging] = useState(false);

  const base = useMemo(
    () =>
      fit === 'width'
        ? widthFitZoom(natural.width, viewport.width)
        : fitZoom(natural, viewport, fitFactor),
    [fit, fitFactor, natural, viewport],
  );
  const current = zoom ?? base;
  const bounds = useMemo(() => panBounds(natural, current, viewport), [natural, current, viewport]);
  const canPan = bounds.x > 0.5 || bounds.y > 0.5;
  const canZoomIn = nextZoom(current) > current + 0.001;
  const canZoomOut = prevZoom(current) < current - 0.001;
  const ready = natural.width > 0 && natural.height > 0;

  // Снимок живого состояния для стабильных обработчиков (нативные слушатели
  // колеса и pointer-жесты не должны перевешиваться на каждый шаг зума).
  const live = useRef({ current, base, natural, viewport, bounds, pan, canPan });
  live.current = { current, base, natural, viewport, bounds, pan, canPan };

  /** Единая точка смены масштаба: панорама пересчитывается вокруг точки. */
  const applyZoom = useCallback((raw: number, point: Offset = CENTER) => {
    const state = live.current;
    const next = clampZoom(raw);
    if (Math.abs(next - state.current) < 0.0001) return;
    setZoomState(next);
    setPan((prev) =>
      clampPan(
        zoomAtPoint(prev, point, state.current, next),
        panBounds(state.natural, next, state.viewport),
      ),
    );
  }, []);

  const reset = useCallback(() => {
    setZoomState(null);
    setPan(CENTER);
  }, []);
  const zoomIn = useCallback(() => applyZoom(nextZoom(live.current.current)), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(prevZoom(live.current.current)), [applyZoom]);
  const toggle = useCallback(
    () => applyZoom(toggleZoom(live.current.current, live.current.base)),
    [applyZoom],
  );

  // Размер области просмотра: вписывание и клампы живут в CSS-пикселях окна.
  // Layout-эффект — чтобы первый кадр не показывал «100%» до замера.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => setViewport({ width: area.clientWidth, height: area.clientHeight });
    measure();
    // jsdom/старые среды без ResizeObserver: остаётся первичный замер.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  // Новая картинка — новый кадр: натуральный размер прошлой не должен
  // масштабировать её до загрузки (и листание не наследует зум).
  useEffect(() => {
    setNatural(ZERO);
    setZoomState(null);
    setPan(CENTER);
    setDragging(false);
  }, [resetKey]);

  // Смена масштаба/окна/картинки может сделать текущий сдвиг недопустимым.
  useEffect(() => {
    setPan((prev) => {
      const next = clampPan(prev, bounds);
      return next.x === prev.x && next.y === prev.y ? prev : next;
    });
  }, [bounds]);

  // Колесо и пинч тачпада. Слушатель НАТИВНЫЙ non-passive: React вешает
  // onWheel пассивно, `preventDefault` в нём не работает — браузер зумит
  // страницу вместо картинки (gotcha frontend).
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (event: WheelEvent) => {
      const state = live.current;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        applyZoom(
          wheelZoom(state.current, event.deltaY),
          pointIn(area, event.clientX, event.clientY),
        );
        return;
      }
      setPan((prev) =>
        clampPan({ x: prev.x - event.deltaX, y: prev.y - event.deltaY }, state.bounds),
      );
    };
    area.addEventListener('wheel', onWheel, { passive: false });
    return () => area.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  const pointers = useRef(new Map<number, Offset>());
  const drag = useRef<{ start: Offset; pan: Offset } | null>(null);
  const pinch = useRef<{ start: number; zoom: number; pan: Offset } | null>(null);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const id = event.pointerId ?? 1;
    const area = event.currentTarget;
    try {
      area.setPointerCapture?.(id);
    } catch {
      /* среда без pointer capture (jsdom) — жест работает и так */
    }
    pointers.current.set(id, { x: event.clientX, y: event.clientY });
    const pair = firstTwo(pointers.current);
    if (pair) {
      const [a, b] = pair;
      pinch.current = {
        start: distance(a, b),
        zoom: live.current.current,
        pan: live.current.pan,
      };
      drag.current = null;
      setDragging(false);
      return;
    }
    if (pointers.current.size === 1) {
      drag.current = { start: { x: event.clientX, y: event.clientY }, pan: live.current.pan };
      setDragging(live.current.canPan);
    }
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const id = event.pointerId ?? 1;
    if (!pointers.current.has(id)) return;
    pointers.current.set(id, { x: event.clientX, y: event.clientY });
    const state = live.current;

    const pair = firstTwo(pointers.current);
    if (pair && pinch.current) {
      const [a, b] = pair;
      const started = pinch.current;
      const next = clampZoom((started.zoom * distance(a, b)) / started.start);
      const center = pointIn(event.currentTarget, (a.x + b.x) / 2, (a.y + b.y) / 2);
      setZoomState(next);
      setPan(
        clampPan(
          zoomAtPoint(started.pan, center, started.zoom, next),
          panBounds(state.natural, next, state.viewport),
        ),
      );
      if (!state.canPan) setDragging(false);
      return;
    }

    const started = drag.current;
    if (!started) return;
    setPan(
      clampPan(
        {
          x: started.pan.x + event.clientX - started.start.x,
          y: started.pan.y + event.clientY - started.start.y,
        },
        state.bounds,
      ),
    );
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const id = event.pointerId ?? 1;
    pointers.current.delete(id);
    try {
      event.currentTarget.releasePointerCapture?.(id);
    } catch {
      /* захват уже снят (pointercancel/touch) */
    }
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      // Один палец из пинча остался — перетаскивание продолжается с него.
      const rest = [...pointers.current.values()][0];
      if (rest) drag.current = { start: rest, pan: live.current.pan };
      return;
    }
    if (pointers.current.size === 0) {
      drag.current = null;
      setDragging(false);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const state = live.current;
      const panBy = (dx: number, dy: number) => {
        setPan((prev) => clampPan({ x: prev.x + dx, y: prev.y + dy }, state.bounds));
      };
      switch (event.key) {
        case '+':
        case '=':
          event.preventDefault();
          applyZoom(nextZoom(state.current));
          break;
        case '-':
        case '_':
          event.preventDefault();
          applyZoom(prevZoom(state.current));
          break;
        case '0':
          event.preventDefault();
          reset();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          panBy(KEY_PAN_STEP, 0);
          break;
        case 'ArrowRight':
          event.preventDefault();
          panBy(-KEY_PAN_STEP, 0);
          break;
        case 'ArrowUp':
          event.preventDefault();
          panBy(0, KEY_PAN_STEP);
          break;
        case 'ArrowDown':
          event.preventDefault();
          panBy(0, -KEY_PAN_STEP);
          break;
        default:
          break;
      }
    },
    [applyZoom, reset],
  );
  const onDoubleClick = useCallback(() => toggle(), [toggle]);
  const onImageLoad = useCallback((event: { currentTarget: HTMLImageElement }) => {
    const image = event.currentTarget;
    setNatural({ width: image.naturalWidth, height: image.naturalHeight });
  }, []);

  const imageStyle: CSSProperties = ready
    ? {
        width: natural.width * current,
        height: natural.height * current,
        transform: `translate(${pan.x}px, ${pan.y}px)`,
      }
    : { transform: `translate(${pan.x}px, ${pan.y}px)` };

  return {
    areaRef,
    ready,
    percent: zoomPercent(current),
    canPan,
    dragging,
    canZoomIn,
    canZoomOut,
    imageStyle,
    reset,
    zoomIn,
    zoomOut,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onKeyDown,
    onDoubleClick,
    onImageLoad,
  };
}

/** Что отдаёт хук: хосту нужен весь набор полей и обработчиков. */
export type ImageZoom = ReturnType<typeof useImageZoom>;
