import { useEffect } from 'react';

import { isModalLayerOpen } from '../../../../shared/attention/modal-layers.js';
import { hasOpenPopperLayer } from '../../../../shared/lib/overlay-layers.js';

/**
 * Esc панели свойств папки (#1030). Слушатель — CAPTURE на window: карточка
 * проекта (`SliderPanel`) слушает Esc в bubble-фазе и зарегистрирована раньше,
 * поэтому без перехвата закрывалась бы вся карточка. Гейты — реестр модальных
 * слоёв и открытый поповер; сама карточка с `role="dialog"` слоем НЕ является
 * (её исключает modal-layers по `data-card-surface`).
 */
export function useNodePanelEscape({
  enabled,
  pendingKind,
  onClose,
  resetKind,
}: {
  enabled: boolean;
  pendingKind: boolean;
  onClose: () => void;
  resetKind: () => void;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (hasOpenPopperLayer() || isModalLayerOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      if (pendingKind) resetKind();
      else onClose();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled, pendingKind, onClose, resetKind]);
}
