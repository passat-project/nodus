import type { ReactNode } from 'react';
import { cn } from '@nodus/ui/lib/utils';

import type { CardTabGroup, CardTabsState } from './card-tabs-model.js';
import type { CardTabDef } from './card-tab-strip.js';

/** id DOM-панели (вкладки могут содержать `:` — заменяем на `-`). */
export const domKey = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '-');

/**
 * Слой содержимого областей (#746): ВСЕ посещённые вкладки живут здесь в
 * стабильном порядке, активная панель каждой области позиционируется над
 * своей колонкой. Перенос вкладки меняет только left/width/visibility —
 * React не ремаунтит панель, скролл чата и зум PDF сохраняются.
 */
export function CardTabPanelLayer({
  state,
  groups,
  tabs,
  widths,
  width,
  baseId,
  renderPanel,
}: {
  state: CardTabsState;
  groups: CardTabGroup[];
  tabs: CardTabDef[];
  widths: number[];
  width: number;
  /** Префикс id полос/панелей (один на карточку). */
  baseId: string;
  renderPanel: (tabId: string) => ReactNode;
}) {
  const positions = new Map(
    groups.map((group, index) => [
      group.active,
      {
        left: widths.slice(0, index).reduce((acc, value) => acc + value, 0),
        width: widths[index] ?? 0,
      },
    ]),
  );
  const visited = new Set(Object.keys(state.visited));
  for (const group of state.groups) for (const tab of group.tabs) visited.add(tab);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {tabs.map((tab) => {
        if (!visited.has(tab.id)) return null;
        const position = positions.get(tab.id);
        const active = Boolean(position);
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${baseId}-tab-${domKey(tab.id)}-panel`}
            aria-labelledby={`${baseId}-tab-${domKey(tab.id)}-tab`}
            inert={!active}
            className={cn(
              'absolute inset-y-0 overflow-hidden',
              !active && 'pointer-events-none invisible',
            )}
            style={
              position
                ? { left: position.left, width: position.width }
                : { left: 0, width: widths[0] ?? width }
            }
          >
            {renderPanel(tab.id)}
          </div>
        );
      })}
    </div>
  );
}
