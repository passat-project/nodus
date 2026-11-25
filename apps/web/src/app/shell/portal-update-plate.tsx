import { useEffect } from 'react';
import { create } from 'zustand';
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
 * Дефолт — однострочная плашка В ПОТОКЕ правой группы топбара (иконки
 * отступают влево, не поверх). Вкусовой overlay-вариант — по URL-параметру
 * `updatePlate=overlay`: плашка отдельным уровнем над линией топбара сверху-
 * справа, шапка уступает место компенсацией padding-right, личный тост-стек
 * уходит ниже на высоту плашки (2rem).
 */

/** TEMP #1038 taste-variant, удалить после вердикта владельца: режим
 *  overlay-плашки по search-параметру `?updatePlate=overlay`. */
export function isPortalUpdateOverlayMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('updatePlate') === 'overlay';
}

/** TEMP #1038 taste-variant, удалить после вердикта владельца: сигнал
 *  «overlay-плашка сейчас висит над шапкой» — топбар даёт группе компенсацию
 *  padding-right, тост-стек уходит ниже. Публикует сама плашка (app-слой):
 *  фича уведомлений не импортирует фичу обновления (I3/I6). */
export const usePortalUpdateOverlayActive = create<{
  active: boolean;
  setActive: (active: boolean) => void;
}>((set) => ({ active: false, setActive: (active) => set({ active }) }));

export function PortalUpdatePlate() {
  const updateAvailable = usePortalUpdateStore((s) => s.updateAvailable);
  const setOverlayActive = usePortalUpdateOverlayActive((s) => s.setActive);
  const overlay = isPortalUpdateOverlayMode();
  useEffect(() => {
    setOverlayActive(overlay && updateAvailable && !isDesktopShell());
    return () => setOverlayActive(false);
  }, [overlay, updateAvailable, setOverlayActive]);
  if (isDesktopShell() || !updateAvailable) return null;
  return overlay ? <OverlayUpdatePlate /> : <InlineUpdatePlate />;
}

function UpdatePlateContent() {
  return (
    <>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
      <span className="min-w-0 truncate text-xs font-medium">{ui.desktop.updatePlate}</span>
      <button
        type="button"
        onClick={reloadPortal}
        className="text-info text-xs font-medium whitespace-nowrap hover:underline"
      >
        {ui.desktop.updatePlateButton}
      </button>
    </>
  );
}

function InlineUpdatePlate() {
  return (
    <div
      role="status"
      data-portal-update-plate
      className="animate-in fade-in-0 flex h-8 shrink-0 items-center gap-2 rounded-md bg-muted px-2.5 duration-150"
    >
      <UpdatePlateContent />
    </div>
  );
}

/** TEMP #1038 taste-variant, удалить после вердикта владельца: плашка над
 *  шапкой отдельным уровнем — fixed сверху-справа, по колонке правых иконок
 *  топбара (right-16); шапка компенсирует место padding-right (top-bar),
 *  тост-стек уходит ниже на высоту плашки. Ширина фиксирована — компенсация
 *  без замеров. */
function OverlayUpdatePlate() {
  return (
    <div
      role="status"
      data-portal-update-plate
      data-portal-update-plate-overlay
      className="node-panel shadow-sm fixed top-0 right-16 z-30 flex h-8 w-[13.5rem] items-center gap-2 rounded-b-xl px-2.5"
    >
      <UpdatePlateContent />
    </div>
  );
}
