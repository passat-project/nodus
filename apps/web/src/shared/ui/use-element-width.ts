import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Ширина элемента через ResizeObserver (для solver'а карточки).
 *
 * Элемент может появиться ПОЗЖЕ первого маунта (карточка сначала рендерит
 * скелетон, данные приходят асинхронно): `ref.current` в первом layout-эффекте
 * ещё null. Поэтому наблюдаемый элемент — состояние, которое обновляется на
 * каждом коммите, если ref уже указывает на новый DOM-узел; наблюдение
 * перезапускается на смену узла.
 *
 * Ширина — LAYOUT-размер (`offsetWidth`/`borderBoxSize`), не
 * `getBoundingClientRect`: карточка открывается FLIP-анимацией раскрытия из
 * строки списка (transform scale), и rect в этот момент возвращает
 * масштабированную ширину. ResizeObserver на transform не срабатывает —
 * измерение навсегда оставалось «узким», справа от полосы вкладок чернел
 * зазор до края карточки (фидбек владельца 11.11).
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const lastRef = useRef(-1);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- узел появляется позже маунта (скелетон): детектор обязан бежать на каждом коммите
  useLayoutEffect(() => {
    const next = ref.current;
    if (next !== element) setElement(next);
  });

  useLayoutEffect(() => {
    if (!element) return;
    const measure = (layoutWidth?: number) => {
      const next = Math.round(layoutWidth ?? element.offsetWidth);
      if (next !== lastRef.current) {
        lastRef.current = next;
        setWidth(next);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      measure(box?.inlineSize);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return width;
}
