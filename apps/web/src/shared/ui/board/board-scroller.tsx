import { useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@nodus/ui/lib/utils';

import { EDGE_ZONE_PX, type EdgeSide } from '../../lib/board/edge-scroll.js';
import { BOARD_ROW_CLASS } from './board-metrics.js';
import { useBoardEdgeScroll } from './use-board-edge-scroll.js';

/**
 * Горизонтальный скроллер канбан-доски — общий для всех досок (#366):
 * ряд колонок + навигация широкой доски (прокрутка подводом курсора к краю,
 * drag-to-pan фона — `use-board-edge-scroll`). Зоны края — индикаторы
 * поверх доски БЕЗ перехвата указателя: клики и меню крайних колонок
 * проходят насквозь, видны только когда в эту сторону есть куда листать.
 * className — отступы конкретной доски (их же зеркалит KanbanSkeleton). Геометрия
 * ряда (зазор, внешние отступы) — из `board-metrics.ts` (#730): узкие колонки и
 * 6+ колонок на Full HD.
 */
export function BoardScroller({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { room, hot, panning, handlers } = useBoardEdgeScroll(ref);

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={ref}
        data-board-scroller=""
        className={cn(BOARD_ROW_CLASS, panning && 'cursor-grabbing select-none', className)}
        {...handlers}
      >
        {children}
      </div>
      <EdgeHints room={room} hot={hot} />
    </div>
  );
}

/** Индикаторы краёв широкой области (доски и таблицы журналов): кладутся
 *  СОСЕДЯМИ скролл-контейнера в relative-обёртку — стоят на месте при
 *  вертикальной прокрутке, указатель не перехватывают. `insetLeft` — ширина
 *  закреплённой слева колонки: левая стрелка встаёт на левый край ДВИЖУЩЕЙСЯ
 *  области, а не поверх колонки (#1006). */
export function EdgeHints({
  room,
  hot,
  show = true,
  insetLeft = 0,
}: {
  room: { left: boolean; right: boolean };
  hot: EdgeSide | null;
  /** Таблицы: индикатор всплывает только при наведении на список (вердикт
   *  владельца 25.10.2026 — «невидимые кнопки»); доска — всегда. */
  show?: boolean;
  /** Отступ левой стрелки от левого края обёртки, px (закреплённая колонка). */
  insetLeft?: number;
}) {
  return (
    <>
      <EdgeHint
        side="left"
        visible={room.left && show}
        hot={hot === 'left'}
        insetLeft={insetLeft}
      />
      <EdgeHint side="right" visible={room.right && show} hot={hot === 'right'} />
    </>
  );
}

function EdgeHint({
  side,
  visible,
  hot,
  insetLeft = 0,
}: {
  side: EdgeSide;
  visible: boolean;
  hot: boolean;
  insetLeft?: number;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <div
      aria-hidden
      data-edge-hint={side}
      style={{
        width: EDGE_ZONE_PX,
        ...(side === 'left' && insetLeft > 0 ? { left: insetLeft } : {}),
      }}
      className={cn(
        'pointer-events-none absolute inset-y-0 z-40 flex items-center justify-center rounded-lg transition-[opacity,background-color] duration-150',
        side === 'left' ? 'left-0' : 'right-0',
        visible ? 'opacity-100' : 'opacity-0',
        hot && 'bg-accent/30',
      )}
    >
      <span
        className={cn(
          'flex size-8 items-center justify-center rounded-full border border-border bg-card transition-colors',
          hot ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
    </div>
  );
}
