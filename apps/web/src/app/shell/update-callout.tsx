import { X } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { usePortalUpdateStore } from '../../features/portal-update/model/portal-update-store.js';

/**
 * Геометрия привязки к кнопке ⟳ (#1038, владелец 25.11): кластер навигации —
 * `pl-1` + назад/вперёд по size-7 (1.75rem) → левый край ⟳ = 3.75rem, центр =
 * 3.75 + 0.875 = 4.625rem. Плашка стоит левым краем ПОД кнопкой, стрелка-
 * ромб (size-2, half 0.25rem) — на 4.625rem, ровно по центру кнопки.
 * Всё в rem — геометрия не плывёт с --ui-scale.
 */

/**
 * Коллаут обновления портала (#1038, фаза B2): зелёная точка на ⟳ сама себя
 * не объясняет — под панелью у кнопки появляется плашка со стрелкой ВВЕРХ на
 * неё. Действия нет (обновление = ⟳), только крестик; после ручного закрытия
 * плашка не возвращается до конца сессии (флаг держит панель).
 */
export function UpdateCallout({ onClose }: { onClose: () => void }) {
  const updateAvailable = usePortalUpdateStore((s) => s.updateAvailable);
  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      data-portal-update-callout
      className="animate-in fade-in-0 absolute top-full left-[3.75rem] z-40 mt-1.5 flex max-w-xs items-center gap-1.5 rounded-lg bg-popover p-2 text-xs text-popover-foreground ring-1 ring-foreground/10 duration-150"
    >
      {/* Стрелка вверх — ромб над кромкой плашки: нижняя половина сливается с
          её фоном (шов кольца перекрыт), верхняя читается как наконечник.
          БЕЗ обводки: у ромба на границе она дала бы артефакт-шеврон. */}
      <span
        aria-hidden
        className="absolute -top-1 left-[0.625rem] size-2 rotate-45 rounded-[1px] bg-popover"
      />
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
  );
}
