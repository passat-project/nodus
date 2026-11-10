import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Ширина элемента через ResizeObserver (для solver'а карточки). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  const lastRef = useRef(-1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next !== lastRef.current) {
        lastRef.current = next;
        setWidth(next);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
