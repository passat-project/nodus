import { useEffect, useRef, type RefObject } from 'react';

/** Порог «у низа» — тот же, что у догона входящих мессенджера. */
const NEAR_BOTTOM_PX = 32;

/**
 * Удержание ленты у низа во время стрима (канон мессенджера). Примитив
 * message-scroller докручивает в rAF — на кадр позже роста, а ответ
 * ассистента растёт из ОТЛОЖЕННОГО рендера Markdown (`useDeferredValue`),
 * минуя layout-эффекты ленты. Поэтому наблюдаем фактическую высоту
 * содержимого: ResizeObserver доставляет колбэк после раскладки и ДО
 * отрисовки — scrollTop успевает за низом, и щель в 1–2 строки не видна
 * (наблюдение владельца 18.11.2026: «докрутка ленты когда отвечает агент»).
 *
 * Читающего историю выше не трогаем: у низа — держим, отлистал — нет.
 */
export function useStickyBottom(viewportRef: RefObject<HTMLElement | null>): void {
  const atBottomRef = useRef(true);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const onScroll = (): void => {
      atBottomRef.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= NEAR_BOTTOM_PX;
    };
    onScroll();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    const content = viewport.querySelector('[data-slot="message-scroller-content"]');
    const observer = new ResizeObserver(() => {
      if (!atBottomRef.current) return;
      const bottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (Math.abs(viewport.scrollTop - bottom) > 1) viewport.scrollTop = bottom;
    });
    if (content) observer.observe(content);
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [viewportRef]);
}
