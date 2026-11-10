/** Вкладки рабочей зоны карточки проекта (#467, #735): «О проекте» —
 *  обычная вкладка после «Задач» (вердикт владельца 10.11.2026), а не
 *  статичная левая панель. «Структура» — системный дефолт и первая у нового
 *  сотрудника; личный порядок (#746) её перекрывает. «Чат проекта» появится
 *  вместе с пространством проекта (#456). */
export type ProjectTabId = 'structure' | 'tasks' | 'about' | 'channel' | 'members' | 'history';

/** Системный порядок вкладок; «О проекте» — после «Задач». */
export const PROJECT_TAB_IDS: readonly ProjectTabId[] = [
  'structure',
  'tasks',
  'about',
  'channel',
  'members',
  'history',
];

/** Старый ключ скрытых вкладок: мигрируется в cardTabs.project.hidden. */
export const LEGACY_PROJECT_TABS_KEY = 'nodus-project-tabs-v2';

function isTabId(value: unknown): value is ProjectTabId {
  return typeof value === 'string' && PROJECT_TAB_IDS.includes(value as ProjectTabId);
}

/** Скрытые вкладки из старой памяти (неизвестные ключи и последняя видимая
 *  отбрасываются — рабочая зона не может остаться пустой). Оставлено для
 *  миграции в cardTabs (#745/#746); новый код читает prefs. */
export function readHiddenTabs(raw: string | null): ProjectTabId[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const hidden = parsed.filter(isTabId);
    const visible = PROJECT_TAB_IDS.filter((id) => !hidden.includes(id));
    return visible.length > 0 ? hidden : hidden.slice(0, -1);
  } catch {
    return [];
  }
}

/** Видимые вкладки в порядке реестра. */
export function visibleTabs(
  tabs: readonly ProjectTabId[],
  hidden: readonly ProjectTabId[],
): ProjectTabId[] {
  return tabs.filter((id) => !hidden.includes(id));
}
