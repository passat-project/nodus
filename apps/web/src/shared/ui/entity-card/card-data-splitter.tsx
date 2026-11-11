import { useCallback, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { ui } from '@nodus/contracts';

/**
 * Перегородка «панель данных | области вкладок» (#746): тянется мышью с
 * императивным style.width (карточка не рендерится на каждый кадр), коммит
 * предпочтения `widths.data` на pointerup; клавиатура (стрелки 8/24 px,
 * Home/End, Enter — дефолт 340) и двойной клик — сброс. Пол — 320 px:
 * данные не сжимаются ниже (I5/research: основной контент защищён).
 */
export function CardDataSplitter({
  dataRef,
  dataW,
  min = 320,
  max,
  onCommit,
  onReset,
}: {
  dataRef: RefObject<HTMLDivElement | null>;
  dataW: number;
  min?: number;
  max: number;
  onCommit: (width: number) => void;
  onReset: () => void;
}) {
  const clamp = useCallback(
    (value: number) => Math.min(Math.max(value, min), Math.max(min, max)),
    [max, min],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const el = dataRef.current;
    if (!el) return;
    const startX = event.clientX;
    const startW = el.getBoundingClientRect().width;
    let latest = startW;
    const onMove = (move: globalThis.PointerEvent) => {
      latest = clamp(startW + (move.clientX - startX));
      el.style.width = `${latest}px`;
      el.style.minWidth = `${latest}px`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      onCommit(Math.round(latest));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onCommit(clamp(dataW - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onCommit(clamp(dataW + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onCommit(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onCommit(clamp(max));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onReset();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ui.common.resizePanel}
      aria-valuenow={Math.round(dataW)}
      aria-valuemin={min}
      aria-valuemax={Math.round(Math.max(min, max))}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="group absolute top-0 right-0 z-20 h-full w-3 translate-x-1/2 cursor-col-resize touch-none outline-none focus-visible:bg-primary/10"
      title={ui.common.resizePanel}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-port/60 opacity-0 transition-[opacity,width,background-color] group-hover:opacity-100 group-focus-visible:w-0.5 group-focus-visible:bg-primary group-focus-visible:opacity-100" />
    </div>
  );
}
