import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import {
  activateTab,
  mergeGroups,
  moveTab,
  reorderTab,
  splitTab,
  type CardTabGroup,
  type CardTabsState,
} from './card-tabs-model.js';
import { CardTabMenu, type CardTabMenuState } from './card-tab-menu.js';
import type { CardTabDef } from './card-tab-strip.js';

/**
 * Контекстное меню вкладки (#746) с действиями модели: перестановка,
 * перенос в другую область, «открыть рядом», соединение, скрытие/закрытие.
 * Альтернатива drag (WCAG 2.5.7); после действия фокус возвращается на
 * вкладку, результат объявляется через aria-live хоста.
 */
export function CardTabContextMenu({
  menu,
  state,
  tabById,
  onClose,
  onApply,
  onAnnounce,
  onFocusTab,
  onCloseTab,
  onHideTab,
  canHideTab,
}: {
  menu: CardTabMenuState | null;
  state: CardTabsState;
  tabById: Map<string, CardTabDef>;
  onClose: () => void;
  onApply: (next: CardTabsState) => void;
  onAnnounce: (text: string) => void;
  onFocusTab: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onHideTab?: (tabId: string) => void;
  canHideTab?: (tabId: string) => boolean;
}) {
  const group: CardTabGroup | undefined = menu
    ? state.groups.find((entry) => entry.id === menu.groupId)
    : undefined;
  const index = group && menu ? group.tabs.indexOf(menu.tabId) : -1;
  const tab = menu ? tabById.get(menu.tabId) : undefined;
  const canHide = Boolean(menu && onHideTab && (canHideTab?.(menu.tabId) ?? true));

  const run = (action: () => void) => {
    onClose();
    action();
    if (menu) onFocusTab(menu.tabId);
  };

  return (
    <CardTabMenu
      menu={menu}
      actions={{
        moveLeft: index > 0,
        moveRight: Boolean(group) && index >= 0 && index < (group?.tabs.length ?? 0) - 1,
        moveToOther: state.groups.length === 2,
        openBeside: state.groups.length === 1 && (state.groups[0]?.tabs.length ?? 0) > 1,
        mergeAreas: state.groups.length === 2,
        close: Boolean(tab?.closable && onCloseTab),
        hide: canHide,
      }}
      onClose={onClose}
      onMoveLeft={() =>
        run(() => {
          if (!menu || !group) return;
          onApply({
            ...state,
            groups: reorderTab(state.groups, group.id, menu.tabId, index - 1),
          });
          onAnnounce(
            ui.cardTabs.reordered.replace('{tab}', menu.label).replace('{index}', String(index)),
          );
        })
      }
      onMoveRight={() =>
        run(() => {
          if (!menu || !group) return;
          onApply({
            ...state,
            groups: reorderTab(state.groups, group.id, menu.tabId, index + 2),
          });
          onAnnounce(
            ui.cardTabs.reordered
              .replace('{tab}', menu.label)
              .replace('{index}', String(index + 2)),
          );
        })
      }
      onMoveToOther={() =>
        run(() => {
          if (!menu) return;
          const target = state.groups.find((entry) => entry.id !== menu.groupId);
          if (!target) return;
          const groups = moveTab(state.groups, target.id, menu.tabId, 'end');
          onApply(
            activateTab({ ...state, groups, focusGroupId: target.id }, target.id, menu.tabId),
          );
          onAnnounce(ui.cardTabs.movedToArea.replace('{tab}', menu.label).replace('{area}', '2'));
        })
      }
      onOpenBeside={() =>
        run(() => {
          if (!menu || state.groups.length >= 2) {
            toast(ui.cardTabs.maxAreas);
            return;
          }
          const groups = splitTab(state.groups, menu.groupId, menu.tabId, 'right');
          const target = groups.find((entry) => entry.tabs.includes(menu.tabId));
          onApply(
            activateTab(
              { ...state, groups, focusGroupId: target?.id ?? null },
              target?.id ?? menu.groupId,
              menu.tabId,
            ),
          );
          onAnnounce(ui.cardTabs.splitDone);
        })
      }
      onMergeAreas={() =>
        run(() => {
          const groups = mergeGroups(state.groups, state.focusGroupId);
          onApply({ ...state, groups, focusGroupId: groups[0]?.id ?? null });
          onAnnounce(ui.cardTabs.merged);
        })
      }
      onCloseTab={() => run(() => menu && onCloseTab?.(menu.tabId))}
      onHideTab={() => run(() => menu && onHideTab?.(menu.tabId))}
    />
  );
}
