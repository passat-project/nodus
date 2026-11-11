import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';
import { ui } from '@nodus/contracts';

import type { CardTabGroup } from './card-tabs-model.js';
import { CardTabStrip, type CardTabDef } from './card-tab-strip.js';

/**
 * Ряд полос областей вкладок (#746): 1–2 полосы с ширинами solver'а.
 * ref-регистрация групп/полос нужна DnD-геометрии (замер на кадр drag);
 * правый слот (`actions`) и «+» (`trailing`) — от карточки.
 */
export function CardTabStripRow({
  groups,
  tabById,
  widths,
  width,
  label,
  baseId,
  draggingTabId,
  actions,
  trailing,
  hint,
  onCloseTab,
  onActivate,
  onTabPointerDown,
  onTabContextMenu,
  onKeyDown,
  registerGroup,
  registerStrip,
}: {
  groups: CardTabGroup[];
  tabById: Map<string, CardTabDef>;
  widths: number[];
  width: number;
  label: string;
  baseId: string;
  draggingTabId: string | null;
  actions: (group: CardTabGroup, active: CardTabDef | undefined) => ReactNode;
  trailing: (group: CardTabGroup) => ReactNode;
  /** Подсказка derived-состояния — в правом слоте ПОСЛЕДНЕЙ области (там же,
   *  где тоггл панели: подсказка объясняет исчезнувшую панель). */
  hint?: ReactNode;
  onCloseTab?: (tabId: string) => void;
  onActivate: (groupId: string, tabId: string) => void;
  onTabPointerDown: (
    groupId: string,
    tabId: string,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  onTabContextMenu: (groupId: string, tabId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (groupId: string) => (event: KeyboardEvent<HTMLDivElement>) => void;
  registerGroup: (groupId: string, el: HTMLDivElement | null) => void;
  registerStrip: (groupId: string, el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="flex h-10 shrink-0 border-b border-border bg-card">
      {groups.map((group, index) => (
        <div
          key={group.id}
          ref={(el) => registerGroup(group.id, el)}
          data-card-tab-group={group.id}
          className="relative min-w-0"
          style={width && widths[index] ? { width: widths[index], flexShrink: 0 } : { flex: 1 }}
        >
          <CardTabStrip
            label={index === 0 ? label : ui.cardTabs.areaLabel.replace('{n}', String(index + 1))}
            tabs={group.tabs.flatMap((id) => {
              const tab = tabById.get(id);
              return tab ? [tab] : [];
            })}
            active={group.active}
            onActivate={(id) => onActivate(group.id, id)}
            onClose={onCloseTab}
            trailing={trailing(group)}
            actions={actions(group, tabById.get(group.active))}
            hint={index === groups.length - 1 ? hint : null}
            groupId={group.id}
            draggingTabId={draggingTabId}
            onTabPointerDown={(tabId, event) => onTabPointerDown(group.id, tabId, event)}
            onTabContextMenu={(tabId, event) => onTabContextMenu(group.id, tabId, event)}
            onKeyDown={onKeyDown(group.id)}
            idPrefix={`${baseId}-tab`}
            stripRef={(el) => registerStrip(group.id, el)}
          />
        </div>
      ))}
    </div>
  );
}
