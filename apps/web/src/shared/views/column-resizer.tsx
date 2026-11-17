import { useCallback, useRef } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { uiPx } from '../ui/ui-scale.js';

/**
 * Ручка регулировки ширины колонки (правая грань хедера таблицы), модель
 * AG Grid/Excel: drag меняет только свою колонку в пределах min/max, двойной
 * клик — автоподбор ширины по контенту. Значение пишется в пресет вида и
 * переживает сессии. Без зависимостей: pointer capture + window listeners.
 * Клавиатура (ARIA Window Splitter, аудит #45): ←/→ — шаг 8px, Enter —
 * автоподбор; aria-valuenow — текущая ширина.
 */
export function ColumnResizer({
  width,
  minWidth,
  maxWidth = uiPx(640),
  onResize,
  onAutoFit,
}: {
  width: number;
  minWidth: number;
  maxWidth?: number;
  onResize: (width: number) => void;
  /** Двойной клик — автоподбор по контенту (Excel). */
  onAutoFit?: () => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = useCallback(
    (w: number) => Math.min(maxWidth, Math.max(minWidth, w)),
    [maxWidth, minWidth],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      drag.current = { startX: event.clientX, startWidth: width };
      const onMove = (e: PointerEvent) => {
        if (!drag.current) return;
        const next = Math.round(drag.current.startWidth + (e.clientX - drag.current.startX));
        onResize(clamp(next));
      };
      const onUp = () => {
        drag.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // pointercancel завершает ресайз: иначе drag.current остаётся живым и
        // колонка продолжает тянуться за курсором после отмены жеста.
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [width, clamp, onResize],
  );

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={ui.common.resizeColumn}
      aria-valuenow={Math.round(width)}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onAutoFit?.();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'ArrowLeft') onResize(clamp(width - uiPx(8)));
        if (e.key === 'ArrowRight') onResize(clamp(width + uiPx(8)));
        if (e.key === 'Enter') onAutoFit?.();
      }}
      className={cn(
        'absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none',
        'after:absolute after:top-1/4 after:right-0.5 after:h-1/2 after:w-px after:bg-border after:transition-colors hover:after:bg-input',
        'focus-visible:outline-2 focus-visible:outline-ring',
      )}
    />
  );
}
