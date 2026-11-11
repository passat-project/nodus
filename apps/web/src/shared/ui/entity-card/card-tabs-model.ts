/**
 * Модель областей вкладок карточки (#746) — чистые функции без React.
 * Одна модель на проект/задачу/письмо: список групп (в v1 — 1–2), активная
 * вкладка каждой группы, посещённые вкладки (монтируются один раз).
 *
 * Инварианты:
 * - вкладка встречается не больше одного раза; группы непустые;
 * - групп 1..max (2); при переполнении лишние сливаются в последнюю;
 * - активная вкладка всегда входит в свою группу;
 * - входные массивы не мутируются (всё возвращает новые структуры).
 *
 * Файловые вкладки (`file:<id>`) — обычные runtime-id; контракт prefs
 * хранит только плейсхолдер `files` (см. card-tabs-prefs.ts).
 */

import { MAX_CARD_TAB_GROUPS, type CardTabGroup, type CardTabsState } from './card-tabs-types.js';

export * from './card-tabs-types.js';
export { resolveDrop } from './card-tabs-drop.js';

/** Следующий стабильный id области: area-1, area-2, … (не пересекается). */
export function nextGroupId(groups: readonly CardTabGroup[]): string {
  let n = 1;
  const used = new Set(groups.map((group) => group.id));
  while (used.has(`area-${n}`)) n += 1;
  return `area-${n}`;
}

/** Убирает вкладку из группы; пустые группы удаляются (кроме последней). */
function withoutTab(
  groups: CardTabGroup[],
  groupId: string,
  tabId: string,
  minGroups = 1,
): CardTabGroup[] {
  return groups.flatMap((group) => {
    if (group.id !== groupId) return [group];
    const tabs = group.tabs.filter((id) => id !== tabId);
    if (tabs.length === 0 && groups.length > minGroups) return [];
    if (tabs.length === 0) return [{ ...group, tabs: [tabId], active: tabId }];
    return [{ ...group, tabs, active: tabs.includes(group.active) ? group.active : tabs[0]! }];
  });
}

/** Вставляет вкладку в группу по индексу (clamp), делая её активной. */
function withTabAt(
  groups: CardTabGroup[],
  groupId: string,
  tabId: string,
  index: number | 'end',
  activate: boolean,
): CardTabGroup[] {
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    const tabs = group.tabs.filter((id) => id !== tabId);
    const at = index === 'end' ? tabs.length : Math.max(0, Math.min(index, tabs.length));
    const next = [...tabs.slice(0, at), tabId, ...tabs.slice(at)];
    return { ...group, tabs: next, active: activate ? tabId : group.active };
  });
}

/**
 * Нормализация групп под известные вкладки: неизвестные/дубли выброшены,
 * пустые группы удалены, групп не больше `max`, активные валидны. Если после
 * фильтрации не осталось ни одной вкладки — одна группа с `fallbackTab`.
 */
export function normalizeGroups(
  groups: readonly CardTabGroup[],
  knownTabs: readonly string[],
  max = MAX_CARD_TAB_GROUPS,
  fallbackTab?: string,
): CardTabGroup[] {
  const known = new Set(knownTabs);
  const seen = new Set<string>();
  const ids = new Set<string>();
  const normalized: CardTabGroup[] = [];

  for (const group of groups) {
    const tabs = group.tabs.filter((tab) => {
      if (!known.has(tab) || seen.has(tab)) return false;
      seen.add(tab);
      return true;
    });
    if (tabs.length === 0) continue;
    let id = group.id;
    if (!id || ids.has(id)) id = nextGroupId(normalized);
    ids.add(id);
    normalized.push({
      id,
      tabs,
      active: tabs.includes(group.active) ? group.active : tabs[0]!,
    });
  }

  if (normalized.length === 0) {
    const tab = fallbackTab && known.has(fallbackTab) ? fallbackTab : knownTabs[0];
    if (!tab) return [];
    return [{ id: 'area-1', tabs: [tab], active: tab }];
  }

  // Переполнение (модель N-ready): лишние области сливаются в последнюю
  // разрешённую, сохраняя порядок вкладок.
  while (normalized.length > max) {
    const overflow = normalized.pop()!;
    const target = normalized[normalized.length - 1]!;
    target.tabs = [...target.tabs, ...overflow.tabs];
    if (!target.tabs.includes(target.active)) target.active = target.tabs[0]!;
  }

  return normalized;
}

/** Создать состояние из групп и активной вкладки (дефолт — первая). */
export function createCardTabsState(
  groups: readonly CardTabGroup[],
  options: { visited?: readonly string[]; activeTab?: string; focusGroupId?: string | null } = {},
): CardTabsState {
  const normalized = groups.map((group) => ({ ...group, tabs: [...group.tabs] }));
  const visited: Record<string, true> = {};
  for (const tab of options.visited ?? normalized.flatMap((group) => group.tabs))
    visited[tab] = true;
  const activeGroup = options.activeTab
    ? normalized.find((group) => group.tabs.includes(options.activeTab!))
    : undefined;
  if (options.activeTab) {
    if (activeGroup) activeGroup.active = options.activeTab;
    else if (normalized[0]) {
      normalized[0].tabs.unshift(options.activeTab);
      normalized[0].active = options.activeTab;
    }
  }
  for (const group of normalized) visited[group.active] = true;
  return {
    groups: normalized,
    visited,
    focusGroupId: options.focusGroupId ?? normalized[0]?.id ?? null,
  };
}

/** Посетить вкладку (содержимое монтируется один раз). */
export function visitTab(state: CardTabsState, tabId: string): CardTabsState {
  if (state.visited[tabId]) return state;
  return { ...state, visited: { ...state.visited, [tabId]: true } };
}

export function activateTab(state: CardTabsState, groupId: string, tabId: string): CardTabsState {
  const group = state.groups.find((entry) => entry.id === groupId);
  if (!group?.tabs.includes(tabId)) return state;
  const groups = state.groups.map((entry) =>
    entry.id === groupId ? { ...entry, active: tabId } : entry,
  );
  return visitTab({ ...state, groups, focusGroupId: groupId }, tabId);
}

/** Перестановка внутри полосы (индекс — позиция вставки ДО удаления). */
export function reorderTab(
  groups: readonly CardTabGroup[],
  groupId: string,
  tabId: string,
  index: number,
): CardTabGroup[] {
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) return [...groups];
  const from = group.tabs.indexOf(tabId);
  if (from < 0) return [...groups];
  let to = Math.max(0, Math.min(index, group.tabs.length));
  if (to > from) to -= 1;
  if (to === from) return [...groups];
  const tabs = group.tabs.filter((id) => id !== tabId);
  tabs.splice(to, 0, tabId);
  return groups.map((entry) => (entry.id === groupId ? { ...entry, tabs } : entry));
}

/**
 * Перенос вкладки в другую область по индексу (`end` — в конец). Исходная
 * пустая область удаляется; целевая активирует вкладку. Если область та же —
 * это перестановка.
 */
export function moveTab(
  groups: readonly CardTabGroup[],
  targetGroupId: string,
  tabId: string,
  index: number | 'end' = 'end',
): CardTabGroup[] {
  const source = groups.find((group) => group.tabs.includes(tabId));
  if (!source) return [...groups];
  if (source.id === targetGroupId) {
    if (index === 'end') {
      return reorderTab(groups, targetGroupId, tabId, source.tabs.length);
    }
    return reorderTab(groups, targetGroupId, tabId, index);
  }
  const without = withoutTab([...groups], source.id, tabId);
  return withTabAt(without, targetGroupId, tabId, index, true);
}

/**
 * Разделить область: вкладка уезжает в новую группу справа/слева (50/50 —
 * ширины решает layout). Больше `max` групп не создаём; одиночная вкладка
 * переносится, исходная пустая группа закрывается.
 */
export function splitTab(
  groups: readonly CardTabGroup[],
  groupId: string,
  tabId: string,
  side: 'left' | 'right' = 'right',
  max = MAX_CARD_TAB_GROUPS,
): CardTabGroup[] {
  if (groups.length >= max) return [...groups];
  const source = groups.find((group) => group.id === groupId);
  if (!source?.tabs.includes(tabId)) return [...groups];
  // minGroups=0: исходная область может опустеть и закрыться — вкладка
  // переезжает в новую группу, рабочая зона не остаётся пустой.
  const without = withoutTab([...groups], groupId, tabId, 0);
  const created: CardTabGroup = { id: nextGroupId(groups), tabs: [tabId], active: tabId };
  const originalIndex = groups.findIndex((group) => group.id === groupId);
  const sourceIndex = without.findIndex((group) => group.id === groupId);
  if (sourceIndex < 0) {
    // Исходная была одиночной и закрылась — новая группа занимает её место
    // (порядок соседей не меняется).
    const at = Math.max(0, Math.min(originalIndex, without.length));
    const next = [...without];
    next.splice(at, 0, created);
    return next;
  }
  const at = side === 'right' ? sourceIndex + 1 : sourceIndex;
  const next = [...without];
  next.splice(at, 0, created);
  return next;
}

/**
 * Соединить области в левую. Активной остаётся вкладка области, с которой
 * работали последним (`focusGroupId`); её нет — активная левой группы.
 */
export function mergeGroups(
  groups: readonly CardTabGroup[],
  focusGroupId: string | null = null,
): CardTabGroup[] {
  if (groups.length <= 1) return [...groups];
  const left = groups[0]!;
  const focus = groups.find((group) => group.id === focusGroupId);
  const tabs: string[] = [];
  for (const group of groups) {
    for (const tab of group.tabs) if (!tabs.includes(tab)) tabs.push(tab);
  }
  const active = focus && tabs.includes(focus.active) ? focus.active : left.active;
  return [{ ...left, tabs, active }];
}

/** Закрыть вкладку: активная уходит к соседу слева/справа; пустая область
 *  (кроме последней) удаляется. Последнюю вкладку последней группы не
 *  закрываем — рабочая зона не остаётся пустой. */
export function closeTab(
  groups: readonly CardTabGroup[],
  groupId: string,
  tabId: string,
): CardTabGroup[] {
  const group = groups.find((entry) => entry.id === groupId);
  if (!group?.tabs.includes(tabId)) return [...groups];
  if (groups.length === 1 && group.tabs.length === 1) return [...groups];
  const index = group.tabs.indexOf(tabId);
  const remaining = group.tabs.filter((id) => id !== tabId);
  const nextActive =
    group.active === tabId
      ? (remaining[index - 1] ?? remaining[index] ?? remaining[0])
      : group.active;
  return groups.flatMap((entry) => {
    if (entry.id !== groupId) return [entry];
    if (remaining.length === 0) return [];
    return [{ ...entry, tabs: remaining, active: nextActive ?? remaining[0]! }];
  });
}

/** Заменить все вкладки группы (порядок из личного набора). */
export function setGroupTabs(
  groups: readonly CardTabGroup[],
  groupId: string,
  tabs: readonly string[],
  active?: string,
): CardTabGroup[] {
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    if (tabs.length === 0) return group;
    const nextActive = active && tabs.includes(active) ? active : group.active;
    return {
      ...group,
      tabs: [...tabs],
      active: tabs.includes(nextActive) ? nextActive : tabs[0]!,
    };
  });
}
