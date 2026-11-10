import type { KeyboardEvent } from 'react';

import { activateTab, type CardTabsState } from './card-tabs-model.js';

/**
 * Клавиатура полосы вкладок (#746): ←/→/Home/End — соседняя вкладка
 * (roving tabindex уже в `CardTabStrip`), Shift+F10/ContextMenu — контекстное
 * меню (альтернатива drag, WCAG 2.5.7). Внутри полей ввода не перехватываем.
 */
export function useCardTabKeyboard({
  state,
  onApply,
  onFocusTab,
  onOpenMenu,
}: {
  state: CardTabsState;
  onApply: (next: CardTabsState) => void;
  onFocusTab: (tabId: string) => void;
  onOpenMenu: (groupId: string, tabId: string, x: number, y: number) => void;
}) {
  return (groupId: string) => (event: KeyboardEvent<HTMLDivElement>) => {
    const group = state.groups.find((entry) => entry.id === groupId);
    if (!group) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const index = group.tabs.indexOf(group.active);

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (group.tabs.length < 2) return;
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = group.tabs[(index + delta + group.tabs.length) % group.tabs.length]!;
      onApply(activateTab(state, groupId, next));
      onFocusTab(next);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? group.tabs[0]! : group.tabs[group.tabs.length - 1]!;
      onApply(activateTab(state, groupId, next));
      onFocusTab(next);
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const el = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
        `[data-card-tab-id="${CSS.escape(group.active)}"]`,
      );
      const rect = el?.getBoundingClientRect();
      onOpenMenu(groupId, group.active, rect?.left ?? 0, rect?.bottom ?? 0);
    }
  };
}
