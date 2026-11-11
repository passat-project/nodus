import { splitTab, mergeGroups, type CardTabsState } from './card-tabs-model.js';

/** Разделить активную вкладку фокусной области (кнопка шапки/меню). */
export function splitActiveTab(state: CardTabsState): CardTabsState {
  const group = state.groups.find((entry) => entry.id === state.focusGroupId) ?? state.groups[0];
  if (!group || state.groups.length >= 2) return state;
  const groups = splitTab(state.groups, group.id, group.active, 'right');
  const target = groups.find((entry) => entry.tabs.includes(group.active));
  return {
    ...state,
    groups,
    focusGroupId: target?.id ?? group.id,
    visited: { ...state.visited, [group.active]: true },
  };
}

/** Соединить области (кнопка шапки/меню); активная — из focus-группы. */
export function mergeAllGroups(state: CardTabsState): CardTabsState {
  if (state.groups.length < 2) return state;
  const groups = mergeGroups(state.groups, state.focusGroupId);
  return { ...state, groups, focusGroupId: groups[0]?.id ?? null };
}
