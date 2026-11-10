import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  resolveDrop,
  type CardTabAreaRect,
  type CardTabsState,
  type DropResolution,
  type RectLike,
} from './card-tabs-model.js';

/** Параметры pointer-перетаскивания вкладки (один pointerId, без dnd-kit). */
export interface CardTabDragOptions {
  state: CardTabsState;
  /** Подпись вкладки для призрака. */
  labelOf: (tabId: string) => string;
  /** Замер живых областей и полос (на текущий кадр). */
  geometry: () => {
    areas: CardTabAreaRect[];
    workArea: RectLike;
    strips: { el: HTMLElement; rect: RectLike }[];
  };
  /** Решение drop — применяет хост (модель/активация). */
  onResolve: (resolution: DropResolution) => void;
}

export interface CardTabDragVisual {
  tabId: string;
  groupId: string;
  label: string;
  x: number;
  y: number;
}

export interface CardTabInsertMarker {
  /** tab — вертикальная линия на полосе; area — линия края новой области. */
  kind: 'tab' | 'area';
  x: number;
  y: number;
  height: number;
}

const START_THRESHOLD = 6;
const EDGE_SCROLL = 24;
const SCROLL_STEP = 14;

/**
 * Тонкий pointer-контроллер перетаскивания вкладок (#746). Почему не
 * dnd-kit: нужна вставка ПО ИНДЕКСУ по серединам вкладок, краевые зоны
 * рабочей зоны и фиксированная линия без сдвига соседей — dnd-kit для этого
 * потребовал бы собственных collision-алгоритмов поверх его drag-цикла;
 * контроллер на PointerEvents даёт те же гарантии (Chrome guidance: pointer
 * capture, один pointerId, Escape, auto-scroll, no-op без линии) без
 * добавления зависимостей. Решение зафиксировано в #746.
 */
export function useCardTabDrag({ state, labelOf, geometry, onResolve }: CardTabDragOptions) {
  const [visual, setVisual] = useState<CardTabDragVisual | null>(null);
  const [marker, setMarker] = useState<CardTabInsertMarker | null>(null);
  const [dragging, setDragging] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const resolveRef = useRef(onResolve);
  resolveRef.current = onResolve;
  const labelRef = useRef(labelOf);
  labelRef.current = labelOf;

  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressUntilRef = useRef(0);

  const suppressClick = useCallback(() => performance.now() < suppressUntilRef.current, []);

  const cancel = useCallback(() => {
    cleanupRef.current?.();
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  const start = useCallback(
    (
      groupId: string,
      tabId: string,
      event: ReactPointerEvent<HTMLElement>,
      element: HTMLElement,
    ) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest('[data-no-tab-drag]')) return;
      if (cleanupRef.current) cleanupRef.current();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let pointerX = startX;
      let pointerY = startY;
      let active = false;
      let finished = false;
      let updateRaf = 0;
      let scrollRaf = 0;
      let lastResolution: DropResolution = { type: 'noop' };
      const previousUserSelect = document.body.style.userSelect;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown);
        element.removeEventListener('lostpointercapture', onLostCapture);
        if (updateRaf) cancelAnimationFrame(updateRaf);
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        document.body.style.userSelect = previousUserSelect;
        try {
          if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
        } catch {
          // capture уже снят браузером
        }
        setVisual(null);
        setMarker(null);
        setDragging(false);
        cleanupRef.current = null;
      };

      const finish = (apply: boolean) => {
        const resolution = lastResolution;
        const moved = active;
        cleanup();
        if (!moved) return;
        // Клик после drop не должен активировать вкладку повторно.
        suppressUntilRef.current = performance.now() + 120;
        if (apply && resolution.type !== 'noop') resolveRef.current(resolution);
      };

      const update = () => {
        updateRaf = 0;
        if (finished || !active) return;
        const { areas, workArea } = geometryRef.current();
        const resolution = resolveDrop({
          groups: stateRef.current.groups,
          source: { groupId, tabId },
          pointer: { x: pointerX, y: pointerY },
          areas,
          workArea,
        });
        lastResolution = resolution;
        let nextMarker: CardTabInsertMarker | null = null;
        if (resolution.type === 'reorder' || resolution.type === 'move') {
          const area = areas.find(
            (entry) =>
              entry.groupId ===
              (resolution.type === 'reorder' ? resolution.groupId : resolution.targetGroupId),
          );
          if (area) {
            const index = resolution.index;
            const before = area.tabs[index];
            const last = area.tabs[area.tabs.length - 1];
            nextMarker = {
              kind: 'tab',
              x: before ? before.rect.left : (last?.rect.right ?? area.strip.right) - 1,
              y: area.strip.top,
              height: Math.max(1, area.strip.bottom - area.strip.top),
            };
          }
        } else if (resolution.type === 'split') {
          nextMarker = {
            kind: 'area',
            x: resolution.side === 'left' ? workArea.left + 1 : workArea.right - 1,
            y: workArea.top,
            height: Math.max(1, workArea.bottom - workArea.top),
          };
        }
        setMarker(nextMarker);
        setVisual({ tabId, groupId, label: labelRef.current(tabId), x: pointerX, y: pointerY });
      };

      const autoScroll = () => {
        if (finished || !active) return;
        const { strips } = geometryRef.current();
        for (const strip of strips) {
          if (pointerY < strip.rect.top || pointerY > strip.rect.bottom) continue;
          const max = strip.el.scrollWidth - strip.el.clientWidth;
          if (max <= 0) continue;
          if (pointerX < strip.rect.left + EDGE_SCROLL) {
            strip.el.scrollLeft = Math.max(0, strip.el.scrollLeft - SCROLL_STEP);
          } else if (pointerX > strip.rect.right - EDGE_SCROLL) {
            strip.el.scrollLeft = Math.min(max, strip.el.scrollLeft + SCROLL_STEP);
          }
        }
        scrollRaf = requestAnimationFrame(autoScroll);
      };

      const activate = () => {
        if (active) return;
        active = true;
        setDragging(true);
        document.body.style.userSelect = 'none';
        try {
          element.setPointerCapture(pointerId);
        } catch {
          // старые браузеры/синтетические события — работаем на window
        }
        element.addEventListener('lostpointercapture', onLostCapture);
        scrollRaf = requestAnimationFrame(autoScroll);
      };

      function onMove(event: globalThis.PointerEvent) {
        if (event.pointerId !== pointerId) return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (!active) {
          const distance = Math.hypot(pointerX - startX, pointerY - startY);
          if (distance < START_THRESHOLD) return;
          activate();
        }
        event.preventDefault();
        if (!updateRaf) updateRaf = requestAnimationFrame(update);
      }

      function onUp(event: globalThis.PointerEvent) {
        if (event.pointerId !== pointerId) return;
        finish(true);
      }

      function onCancel(event: globalThis.PointerEvent) {
        if (event.pointerId !== pointerId) return;
        finish(false);
      }

      function onLostCapture() {
        // capture потерян не по нашему pointerup — отмена, состояние не меняем.
        if (!finished) finish(false);
      }

      function onKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown, true);
      cleanupRef.current = () => {
        if (!active) {
          finished = true;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
          window.removeEventListener('keydown', onKeyDown, true);
          cleanupRef.current = null;
          return;
        }
        finish(false);
      };
    },
    [],
  );

  return { start, cancel, visual, marker, dragging, suppressClick };
}
