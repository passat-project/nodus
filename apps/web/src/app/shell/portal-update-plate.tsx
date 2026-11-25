import { ui } from '@nodus/contracts';

import { usePortalUpdateStore } from '../../features/portal-update/model/portal-update-store.js';
import { isDesktopShell } from '../../shared/desktop/desktop-bridge.js';
import { reloadPortal } from './reload-portal.js';

/**
 * Плашка «Портал обновился» (#1038, фаза F): зелёная точка + текст + кнопка
 * «Обновить» (перезагрузка страницы). ТОЛЬКО в браузере — в десктоп-оболочке
 * обновление применяет панель окна. Постоянна до перезагрузки: закрывать нечего,
 * версия сборки сменится только перезагрузкой.
 *
 * Одна строка В ПОТОКЕ правой группы топбара (иконки отступают влево, не
 * поверх) — вкусовая развилка закрыта вердиктом владельца 25.11: overlay-уровень
 * над шапкой отклонён, временный вариант удалён.
 */
export function PortalUpdatePlate() {
  const updateAvailable = usePortalUpdateStore((s) => s.updateAvailable);
  if (isDesktopShell() || !updateAvailable) return null;
  return (
    <div
      role="status"
      data-portal-update-plate
      className="animate-in fade-in-0 flex h-8 shrink-0 items-center gap-2 rounded-md bg-muted px-2.5 duration-150"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
      <span className="min-w-0 truncate text-xs font-medium">{ui.desktop.updatePlate}</span>
      <button
        type="button"
        onClick={reloadPortal}
        className="text-info text-xs font-medium whitespace-nowrap hover:underline"
      >
        {ui.desktop.updatePlateButton}
      </button>
    </div>
  );
}
