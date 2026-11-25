import { ArrowUpRight, X } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { usePortalUpdateStore } from '../../features/portal-update/model/portal-update-store.js';

/**
 * Коллаут обновления портала (#1038, фаза B2): зелёная точка на ⟳ сама себя
 * не объясняет — под панелью слева появляется плашка со стрелкой вправо-вверх
 * на кнопку. Действия нет (обновление = ⟳), только крестик; после ручного
 * закрытия плашка не возвращается до конца сессии (флаг держит панель).
 */
export function UpdateCallout({ onClose }: { onClose: () => void }) {
  const updateAvailable = usePortalUpdateStore((s) => s.updateAvailable);
  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      data-portal-update-callout
      className="animate-in fade-in-0 absolute top-full left-2 z-40 mt-1.5 flex max-w-xs items-center gap-1.5 rounded-lg bg-popover p-2 text-xs text-popover-foreground ring-1 ring-foreground/10 duration-150"
    >
      <ArrowUpRight className="size-3.5 shrink-0 text-info" strokeWidth={1.75} />
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
