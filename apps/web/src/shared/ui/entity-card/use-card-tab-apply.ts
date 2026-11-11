import { useCallback } from 'react';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import {
  activateTab,
  moveTab,
  reorderTab,
  splitTab,
  type CardTabsState,
  type DropResolution,
} from './card-tabs-model.js';
import type { CardTabDef } from './card-tab-strip.js';

/** Применение решения drop к модели + объявление/фокус (#746). */
export function useCardTabApply({
  state,
  tabById,
  onApply,
  onAnnounce,
  onFocusTab,
}: {
  state: CardTabsState;
  tabById: Map<string, CardTabDef>;
  onApply: (next: CardTabsState) => void;
  onAnnounce: (text: string) => void;
  onFocusTab: (tabId: string) => void;
}) {
  return useCallback(
    (resolution: DropResolution) => {
      if (resolution.type === 'noop') return;
      if (resolution.type === 'activate') {
        onApply(activateTab(state, resolution.groupId, resolution.tabId));
        return;
      }
      if (resolution.type === 'reorder') {
        onApply({
          ...state,
          groups: reorderTab(state.groups, resolution.groupId, resolution.tabId, resolution.index),
          focusGroupId: resolution.groupId,
        });
        const label = tabById.get(resolution.tabId)?.label ?? resolution.tabId;
        onAnnounce(
          ui.cardTabs.reordered
            .replace('{tab}', label)
            .replace('{index}', String(resolution.index + 1)),
        );
        onFocusTab(resolution.tabId);
        return;
      }
      if (resolution.type === 'move' || resolution.type === 'move-end') {
        const targetGroupId = resolution.targetGroupId;
        const index = resolution.type === 'move' ? resolution.index : 'end';
        const groups = moveTab(state.groups, targetGroupId, resolution.tabId, index);
        const next = activateTab(
          { ...state, groups, focusGroupId: targetGroupId },
          targetGroupId,
          resolution.tabId,
        );
        onApply(next);
        const label = tabById.get(resolution.tabId)?.label ?? resolution.tabId;
        const areaIndex = groups.findIndex((group) => group.id === targetGroupId) + 1;
        onAnnounce(
          ui.cardTabs.movedToArea.replace('{tab}', label).replace('{area}', String(areaIndex)),
        );
        onFocusTab(resolution.tabId);
        return;
      }
      if (resolution.type === 'split') {
        if (state.groups.length >= 2) {
          toast(ui.cardTabs.maxAreas);
          return;
        }
        const groups = splitTab(
          state.groups,
          resolution.groupId,
          resolution.tabId,
          resolution.side,
        );
        const target = groups.find((group) => group.tabs.includes(resolution.tabId));
        onApply(
          activateTab(
            { ...state, groups, focusGroupId: target?.id ?? state.focusGroupId },
            target?.id ?? resolution.groupId,
            resolution.tabId,
          ),
        );
        onAnnounce(ui.cardTabs.splitDone);
        onFocusTab(resolution.tabId);
      }
    },
    [onAnnounce, onApply, onFocusTab, state, tabById],
  );
}
