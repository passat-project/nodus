import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';

import { usePortalUpdateStore } from '../../features/portal-update/model/portal-update-store.js';
import { UI_SCALE } from '../../shared/ui/ui-scale.js';

/**
 * Геометрия привязки к кнопке ⟳ (#1038, владелец 25.11): кластер навигации —
 * `pl-1` + назад/вперёд по size-7 (1.75rem) → левый край ⟳ = 3.75rem, центр =
 * 3.75 + 0.875 = 4.625rem. Плашка стоит левым краем ПОД кнопкой, стрелка —
 * на 0.875rem от края плашки, ровно по центру кнопки. Всё в rem/UI_SCALE —
 * геометрия не плывёт с --ui-scale.
 */

/** Радиус углов плашки = rounded-lg токена (0.5rem = 8 дизайн-px). */
const RADIUS = 8 * UI_SCALE;
/** Центр стрелки от левого края плашки = 0.875rem (центр кнопки ⟳). */
const ARROW_OFFSET = 14 * UI_SCALE;
/** Стрелка (дизайн-px): полуоснование и высота наконечника над кромкой. */
const ARROW_HALF_BASE = 6;
const ARROW_HEIGHT = 6;

const f = (n: number) => Math.round(n * 100) / 100;

/**
 * Замкнутый силуэт плашки СО СТРЕЛКОЙ одним контуром (css px, по часовой):
 * кромка идёт по верхнему краю, в точке стрелки уходит вверх на наконечник
 * и возвращается — граница НЕ прерывается. Канон bubble-outline (#155):
 * CSS-рамка + отдельная стрелка — два растеризатора, на дробных зумах
 * расходятся («уголок тоньше рамки», вердикт владельца 25.11); один SVG-штрих
 * — расходиться нечем.
 */
function calloutPath(w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h / 2);
  const ax = ARROW_OFFSET;
  return (
    `M${f(r)} 0` +
    ` H${f(ax - ARROW_HALF_BASE)}` +
    ` L${f(ax)} ${f(-ARROW_HEIGHT)}` +
    ` L${f(ax + ARROW_HALF_BASE)} 0` +
    ` H${f(w - r)}` +
    ` A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}` +
    ` V${f(h - r)}` +
    ` A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}` +
    ` H${f(r)}` +
    ` A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}` +
    ` V${f(r)}` +
    ` A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`
  );
}

/**
 * Коллаут обновления портала (#1038, фаза B2): зелёная точка на ⟳ сама себя
 * не объясняет — под панелью у кнопки появляется плашка со стрелкой ВВЕРХ на
 * неё. Действия нет (обновление = ⟳), только крестик; после ручного закрытия
 * плашка не возвращается до конца сессии (флаг держит панель). Заливка и
 * граница — SVG-слой ПОД контентом (самозамер + ResizeObserver, урок
 * bubble-outline: пустой svg не прятать — он держит раскладку).
 */
export function UpdateCallout({ onClose }: { onClose: () => void }) {
  const updateAvailable = usePortalUpdateStore((s) => s.updateAvailable);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !updateAvailable) return;
    const measure = () => {
      const styles = getComputedStyle(el);
      setBox({
        w: Number.parseFloat(styles.width) || 0,
        h: Number.parseFloat(styles.height) || 0,
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [updateAvailable]);

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      data-portal-update-callout
      className="animate-in fade-in-0 absolute top-full left-[3.75rem] z-40 mt-1.5 duration-150"
    >
      {/* Силуэт + граница одним контуром (канон пузырей #155): стрелка — часть
          пути, обводка через неё течёт без стыка и без утоньшения. */}
      <svg aria-hidden className="absolute inset-0 h-full w-full overflow-visible">
        {box && box.w > 0 ? (
          <path
            d={calloutPath(box.w, box.h)}
            fill="var(--color-popover)"
            stroke="var(--color-foreground)"
            strokeOpacity={0.1}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
      <div
        ref={boxRef}
        className="relative flex max-w-xs items-center gap-1.5 p-2 text-xs text-popover-foreground"
      >
        <span className="min-w-0">{ui.desktop.updateCallout}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={ui.common.close}
          title={ui.common.close}
          className="ml-0.5 flex shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
