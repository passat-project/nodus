import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Перегородка между двумя областями вкладок (#746): тянется мышью/пальцем,
 * фокусируется с клавиатуры (стрелки 8 px, Shift 24, Home/End — к минимуму/
 * максимуму), двойной клик/Enter — 50/50. Роль `separator` с aria-valuenow.
 * Перегородка — оверлей поверх границы: трек не съедает ширину, поэтому
 * пороги solver'а не зависят от неё.
 */
export function CardTabSplitter({
  leftW,
  totalW,
  minLeft,
  minRight,
  onChange,
  onCommit,
  onReset,
  className,
}: {
  leftW: number;
  totalW: number;
  minLeft: number;
  minRight: number;
  /** Отрисовка во время тяги/клавиатуры (px левой области). */
  onChange: (leftW: number) => void;
  /** Коммит предпочтения: pointerup / шаг клавиатуры. */
  onCommit: (leftW: number) => void;
  /** Двойной клик/Enter — сброс 50/50. */
  onReset: () => void;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, w: leftW });
  const maxLeft = Math.max(minLeft, totalW - minRight);
  const clamp = useCallback(
    (value: number) => Math.min(Math.max(value, minLeft), maxLeft),
    [minLeft, maxLeft],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    startRef.current = { x: event.clientX, w: leftW };
    setDragging(true);
    const onMove = (move: globalThis.PointerEvent) => {
      onChange(clamp(startRef.current.w + (move.clientX - startRef.current.x)));
    };
    const onUp = (up: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragging(false);
      onCommit(clamp(startRef.current.w + (up.clientX - startRef.current.x)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onChange(clamp(leftW - step));
      onCommit(clamp(leftW - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onChange(clamp(leftW + step));
      onCommit(clamp(leftW + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(minLeft);
      onCommit(minLeft);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(maxLeft);
      onCommit(maxLeft);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onReset();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ui.cardTabs.resize}
      aria-valuenow={Math.round(leftW)}
      aria-valuemin={minLeft}
      aria-valuemax={Math.round(maxLeft)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        'group absolute inset-y-0 z-20 w-3 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
      style={{ left: leftW }}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors',
          dragging ? 'bg-port' : 'group-hover:bg-port/60 group-focus-visible:bg-port',
        )}
      />
    </div>
  );
}
