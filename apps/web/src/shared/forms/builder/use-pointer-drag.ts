import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Перетаскивание элементов окна (#496, Р2): свой pointer-drag вместо
 * dnd-kit sortable — у элементов переменная ширина (половина/вся строка) и
 * оформление, сортируемый список одной оси их не раскладывает. Порог 6px
 * (клик по ручке — не перенос), Esc отменяет и не закрывает окно редактора
 * (перехват в capture на window — раньше Radix на document).
 */

const DRAG_THRESHOLD = 6;

export interface DropRect {
  index: number;
  /** Элемент делит строку с соседом: «перед» решает горизонталь. */
  paired: boolean;
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Индекс, ПЕРЕД которым встанет элемент под указателем (0..n). */
export function dropTarget(rects: readonly DropRect[], x: number, y: number): number {
  for (const rect of rects) {
    if (y < rect.top) return rect.index;
    if (y > rect.top + rect.height) continue;
    if (rect.paired ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2) {
      return rect.index;
    }
  }
  return rects.length === 0 ? 0 : rects[rects.length - 1]!.index + 1;
}

export interface DragIndicator {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BuilderDrag {
  from: number;
  before: number;
  indicator: DragIndicator | null;
}

function measure(container: HTMLElement): DropRect[] {
  return [...container.querySelectorAll<HTMLElement>('[data-builder-index]')].map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      index: Number(element.dataset.builderIndex),
      paired: element.dataset.builderPaired === 'true',
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  });
}

/** Линия места вставки в координатах контейнера. */
function indicatorOf(
  container: HTMLElement,
  rects: readonly DropRect[],
  before: number,
): DragIndicator | null {
  const box = container.getBoundingClientRect();
  const target = rects.find((rect) => rect.index === before);
  if (target?.paired) {
    return {
      left: target.left - box.left - 7,
      top: target.top - box.top,
      width: 2,
      height: target.height,
    };
  }
  if (target) {
    return {
      left: target.left - box.left,
      top: target.top - box.top - 7,
      width: target.width,
      height: 2,
    };
  }
  const last = rects[rects.length - 1];
  if (!last) return null;
  return { left: 0, top: last.top - box.top + last.height + 5, width: box.width, height: 2 };
}

export function usePointerDrag(
  containerRef: RefObject<HTMLElement | null>,
  onDrop: (from: number, before: number) => void,
) {
  const [drag, setDrag] = useState<BuilderDrag | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const begin = useCallback(
    (event: React.PointerEvent<HTMLElement>, from: number) => {
      const container = containerRef.current;
      if (event.button !== 0 || !container) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      let last: BuilderDrag | null = null;

      const move = (e: PointerEvent) => {
        if (!last && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        const rects = measure(container);
        const before = dropTarget(rects, e.clientX, e.clientY);
        last = { from, before, indicator: indicatorOf(container, rects, before) };
        setDrag(last);
      };
      const finish = (commit: boolean) => {
        cleanup();
        setDrag(null);
        if (commit && last) onDropRef.current(last.from, last.before);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const key = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      };
      function cleanup() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', key, true);
        cleanupRef.current = null;
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
      cleanupRef.current = cleanup;
    },
    [containerRef],
  );

  return { drag, begin };
}
