import {
  cardTabsPrefSchema,
  type CardKind,
  type CardTabGroupPref,
  type CardTabsPref,
} from '@nodus/contracts';

/** Старые ключи раскладки (до #746): мигрируются один раз на вид карточки. */
export const LEGACY_PROJECT_TABS_KEY = 'nodus-project-tabs-v2';
export const LEGACY_CHAT_WIDTH_KEY = 'nodus-card-chat-w-v2';
const LEGACY_FLAG_PREFIX = 'nodus-card-tabs-migrated-v1';

import { normalizeGroups, type CardTabGroup, type CardTabsState } from './card-tabs-model.js';

/** Стабильный плейсхолдер файловых вкладок в prefs (`files`, не `file:<id>`). */
export const FILE_TAB_PLACEHOLDER = 'files';

export function isFileTabId(tabId: string): boolean {
  return tabId.startsWith('file:');
}

/** id вкладки в формате prefs: файл → общий плейсхолдер. */
export function toPrefTab(tabId: string): string {
  return isFileTabId(tabId) ? FILE_TAB_PLACEHOLDER : tabId;
}

/** Восстановление раскладки: `files` разворачивается в реальные вкладки. */
export interface GroupsFromPrefOptions {
  /** Стабильные вкладки карточки в системном порядке (видимые — без скрытых). */
  stableTabs: readonly string[];
  /** Открытые сейчас файловые вкладки (runtime id `file:<id>`). */
  fileTabs?: readonly string[];
  /** Скрытые стабильные вкладки (files не скрывается). */
  hidden?: readonly string[];
  /** Не больше двух областей (v1). */
  maxGroups?: number;
}

/**
 * Собрать runtime-группы из личных prefs: `files` → реальные файловые
 * вкладки, неизвестные id отброшены, скрытые не показываются, новые
 * системные вкладки дописаны в первую область (не теряются), активная
 * вкладка — сохранённая или первая видимая. Пустой/битый prefs — одна
 * область в системном порядке.
 */
export function groupsFromPref(
  pref: CardTabsPref | undefined,
  { stableTabs, fileTabs = [], hidden = [], maxGroups = 2 }: GroupsFromPrefOptions,
): CardTabGroup[] {
  const files = fileTabs.slice();
  const hiddenSet = new Set(hidden.filter((id) => id !== FILE_TAB_PLACEHOLDER));
  const visibleStable = stableTabs.filter((id) => !hiddenSet.has(id));
  const known = new Set([...visibleStable, ...files, FILE_TAB_PLACEHOLDER]);
  const fileGroupIndex = pref
    ? pref.groups.findIndex((group) => group.tabs.includes(FILE_TAB_PLACEHOLDER))
    : -1;

  const resolved: { tabs: string[]; active?: string }[] = [];
  for (const [index, group] of (pref?.groups ?? []).entries()) {
    const tabs: string[] = [];
    for (const tab of group.tabs) {
      if (tab === FILE_TAB_PLACEHOLDER) {
        // Файлы живут в ОДНОЙ области (первой, где был плейсхолдер).
        if (index === fileGroupIndex) tabs.push(...files);
        continue;
      }
      if (!known.has(tab) || hiddenSet.has(tab)) continue;
      tabs.push(tab);
    }
    const deduped = [...new Set(tabs)];
    if (deduped.length === 0) continue;
    const active =
      group.active === FILE_TAB_PLACEHOLDER
        ? (deduped.find((id) => isFileTabId(id)) ?? deduped[0])
        : group.active && deduped.includes(group.active)
          ? group.active
          : undefined;
    resolved.push({ tabs: deduped, active });
  }

  // Новые системные вкладки, которых не было в сохранённом порядке, —
  // в конец первой области и видимы (иначе они бы «пропали» после релиза).
  if (resolved.length > 0) {
    const placed = new Set(resolved.flatMap((group) => group.tabs));
    const added = visibleStable.filter((id) => !placed.has(id));
    if (added.length > 0) resolved[0]!.tabs.push(...added);
  }

  // Файлы открыты, но области файлов в prefs не было — в первую область.
  if (files.length > 0 && !resolved.some((group) => group.tabs.some(isFileTabId))) {
    if (resolved.length > 0) resolved[0]!.tabs.push(...files);
    else resolved.push({ tabs: [...visibleStable, ...files] });
  }

  if (resolved.length === 0) {
    const fallback = [...visibleStable, ...files];
    if (fallback.length === 0) return [];
    return [{ id: 'area-1', tabs: fallback, active: fallback[0]! }];
  }

  const groups: CardTabGroup[] = resolved.slice(0, maxGroups).map((group, index) => ({
    id: `area-${index + 1}`,
    tabs: group.tabs,
    active: group.active && group.tabs.includes(group.active) ? group.active : group.tabs[0]!,
  }));

  // Переполнение prefs (2+) уже обрезано, но normalizeGroups ещё раз
  // гарантирует дедуп/непустоту/активные.
  return normalizeGroups(groups, [...visibleStable, ...files], maxGroups, visibleStable[0]);
}

/** Скрытые вкладки из prefs (files скрывать нельзя; неизвестные — мимо). */
export function hiddenFromPref(
  pref: CardTabsPref | undefined,
  stableTabs: readonly string[],
): string[] {
  const known = new Set(stableTabs);
  return (pref?.hidden ?? []).filter(
    (id) => id !== FILE_TAB_PLACEHOLDER && known.has(toPrefTab(id)),
  );
}

/** Включить/выключить вкладку в личном наборе. Последнюю видимую скрыть
 *  нельзя — возвращаем прежний список. */
export function toggleHiddenTab(
  hidden: readonly string[],
  tabId: string,
  stableTabs: readonly string[],
): string[] {
  if (tabId === FILE_TAB_PLACEHOLDER) return [...hidden];
  if (hidden.includes(tabId)) return hidden.filter((id) => id !== tabId);
  const visible = stableTabs.filter((id) => !hidden.includes(id));
  if (visible.length <= 1) return [...hidden];
  return [...hidden, tabId];
}

/**
 * Сериализация runtime-состояния в контракт prefs (#745). Файловые вкладки
 * схлопываются в один `files`; если файлы оказались в двух областях,
 * плейсхолдер остаётся в ПЕРВОЙ, из второй файлы убираются (пустая область
 * отбрасывается) — контракт запрещает `files` дважды.
 */
export function prefFromState(
  state: Pick<CardTabsState, 'groups'>,
  options: {
    hidden?: readonly string[];
    widths?: { data?: number; groups?: number[] };
    panelOpen?: boolean;
  } = {},
): CardTabsPref | null {
  const firstFilesGroup = state.groups.findIndex((group) => group.tabs.some(isFileTabId));
  const groups: CardTabGroupPref[] = [];

  for (const [index, group] of state.groups.entries()) {
    const tabs: string[] = [];
    let active: string | undefined;
    for (const tab of group.tabs) {
      if (isFileTabId(tab)) {
        if (index !== firstFilesGroup) continue;
        if (!tabs.includes(FILE_TAB_PLACEHOLDER)) tabs.push(FILE_TAB_PLACEHOLDER);
        if (group.active === tab) active = FILE_TAB_PLACEHOLDER;
        continue;
      }
      if (!tabs.includes(tab)) tabs.push(tab);
      if (group.active === tab) active = tab;
    }
    if (tabs.length === 0) continue;
    groups.push({ tabs, active: active && tabs.includes(active) ? active : tabs[0]! });
  }

  // Схема требует хотя бы одну непустую группу; пустую карточку не пишем
  // (вызывающий код сохраняет прежние настройки) — никаких хардкод-id (I15).
  if (groups.length === 0) return null;

  return cardTabsPrefSchema.parse({
    version: 1,
    groups: groups.slice(0, 2),
    hidden: [...(options.hidden ?? [])],
    widths: options.widths,
    panelOpen: options.panelOpen,
  });
}

/** Безопасное чтение prefs из неизвестного JSON (localStorage): битое —
 *  undefined, портал не падает. */
export function parseCardTabsPref(raw: unknown): CardTabsPref | undefined {
  const parsed = cardTabsPrefSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Системная первая видимая вкладка (дефолт без личного порядка). */
export function firstVisibleTab(
  stableTabs: readonly string[],
  hidden: readonly string[] = [],
): string | undefined {
  return stableTabs.find((id) => !hidden.includes(id));
}

/** Виды карточек для prefs (порядок — как в контракте). */
export const CARD_KINDS: readonly CardKind[] = ['project', 'task', 'letter'];

function readLegacyJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Миграция старых ключей в `cardTabs` (#745/#746): скрытые вкладки проекта
 * (`nodus-project-tabs-v2`) и ширина чата (`nodus-card-chat-w-v2`). Читается
 * один раз на вид карточки (флаг в localStorage); неизвестные id
 * отбрасываются, последняя видимая вкладка остаётся. Возвращает undefined,
 * если мигрировать нечего — вызывающий код просто пишет системный дефолт.
 */
export function legacyPrefFor(
  kind: CardKind,
  stableTabs: readonly string[],
  defaultActive?: string,
): CardTabsPref | undefined {
  const flag = `${LEGACY_FLAG_PREFIX}:${kind}`;
  if (localStorage.getItem(flag)) return undefined;

  if (kind === 'project') {
    const raw = readLegacyJson(LEGACY_PROJECT_TABS_KEY);
    const hidden = Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string' && stableTabs.includes(id))
      : [];
    const visible = stableTabs.filter((id) => !hidden.includes(id));
    // Последнюю видимую вкладку не теряем.
    const safeHidden = visible.length > 0 ? hidden : hidden.slice(0, -1);
    const shown =
      visible.length > 0 ? visible : stableTabs.filter((id) => !safeHidden.includes(id));
    if (shown.length === 0) return undefined;
    return {
      version: 1,
      groups: [
        {
          tabs: shown,
          active: defaultActive && shown.includes(defaultActive) ? defaultActive : shown[0]!,
        },
      ],
      hidden: safeHidden,
    };
  }

  if (kind === 'task' || kind === 'letter') {
    const width = Number(localStorage.getItem(LEGACY_CHAT_WIDTH_KEY));
    if (!Number.isFinite(width) || width <= 0) return undefined;
    const tabs = stableTabs.slice();
    if (tabs.length === 0) return undefined;
    return {
      version: 1,
      groups: [
        { tabs, active: defaultActive && tabs.includes(defaultActive) ? defaultActive : tabs[0]! },
      ],
      widths: { groups: [Math.round(width)] },
    };
  }

  return undefined;
}

/** Пометить миграцию выполненной (после успешной записи prefs). */
export function markLegacyMigrated(kind: CardKind): void {
  localStorage.setItem(`${LEGACY_FLAG_PREFIX}:${kind}`, '1');
}

/** Миграция уже выполнена? */
export function legacyMigrationDone(kind: CardKind): boolean {
  return localStorage.getItem(`${LEGACY_FLAG_PREFIX}:${kind}`) === '1';
}
