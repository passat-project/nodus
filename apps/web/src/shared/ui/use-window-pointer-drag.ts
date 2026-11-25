import { useCallback, useEffect, useRef } from 'react';

/**
 * Тяга мышью/пальцем на window-слушателях с гарантированным снятием (#1032):
 * карточка может закрыться (Esc, переход) прямо во время drag — без cleanup
 * `pointermove/pointerup` переживают размонтирование, и следующее отпускание
 * пишет ширину уже закрытой карточки. Хук снимает слушатели при размонтировании
 * и при повторном старте; `pointercancel` завершает жест как отпускание.
 */
export function useWindowPointerDrag(): (handlers: {
  onMove: (event: globalThis.PointerEvent) => void;
  onEnd: (event: globalThis.PointerEvent) => void;
}) => void {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    [],
  );

  return useCallback(({ onMove, onEnd }) => {
    // Повторный pointerdown без pointerup (жест оборвался) — прежние снимаем.
    cleanupRef.current?.();

    const move = (event: globalThis.PointerEvent) => onMove(event);
    const end = (event: globalThis.PointerEvent) => {
      cleanupRef.current?.();
      onEnd(event);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, []);
}
