import { createPortal } from 'react-dom';
import { cn } from '@nodus/ui/lib/utils';

import type { CardTabDragVisual, CardTabInsertMarker } from './use-card-tab-drag.js';

/**
 * Слой chrome перетаскивания вкладки (#746): призрак вкладки и линия вставки.
 * Портал в `body`, потому что `fixed` внутри карточки считается от
 * трансформированной секции слайдера (origin карточки) и клипается её
 * `overflow-hidden`: линия у края уезжала за карточку. В `body` координаты
 * drag-геометрии = координаты вьюпорта; z-[60] — над слайдерами (50) и ниже
 * порталов/тостов (70), лестница z канона не ломается.
 */
export function CardTabDndLayer({
  marker,
  visual,
}: {
  marker: CardTabInsertMarker | null;
  visual: CardTabDragVisual | null;
}) {
  if (!marker && !visual) return null;
  return createPortal(
    <>
      {marker ? (
        <div
          aria-hidden
          data-insert-marker
          data-insert-kind={marker.kind}
          className={cn(
            'pointer-events-none fixed z-[60]',
            marker.kind === 'tab'
              ? 'rounded-lg border border-dashed border-primary/70 bg-primary/15 shadow-[0_2px_12px] shadow-primary/20'
              : 'rounded-2xl border-2 border-dashed border-primary/45 bg-primary/10 ring-1 ring-primary/10',
          )}
          style={{
            left: marker.x,
            top: marker.y,
            width: marker.width,
            height: marker.height,
          }}
        />
      ) : null}

      {visual ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[60] flex h-8 max-w-52 -translate-y-1/2 translate-x-2 items-center rounded-lg border border-border bg-popover px-2 text-body-xs text-foreground shadow-md"
          style={{ left: visual.x, top: visual.y }}
        >
          <span className="truncate">{visual.label}</span>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
