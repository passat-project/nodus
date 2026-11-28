/** Вкладки рабочей зоны карточки проекта (#467, #735): «О проекте» —
 *  обычная вкладка после «Задач» (вердикт владельца 10.11.2026), а не
 *  статичная левая панель. «Структура» — системный дефолт и первая у нового
 *  сотрудника; личный порядок (#746) её перекрывает. «Чат проекта» появится
 *  вместе с пространством проекта (#456).
 *  #435: вкладки-списки — динамические (сохранённые настройки рамки проекта,
 *  `view:<savedViewId>`), идут после «Задач». */
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

/** id вкладки-списка (сохранённая настройка рамки проекта). */
export function projectViewTabId(viewId: string): string {
  return `view:${viewId}`;
}

/** id — вкладка-список? (сохранённая настройка #435). */
export function isProjectViewTabId(tabId: string): boolean {
  return tabId.startsWith('view:');
}

/** id сохранённой настройки из id вкладки. */
export function savedViewIdOfTab(tabId: string): string | null {
  return isProjectViewTabId(tabId) ? tabId.slice('view:'.length) : null;
}

/** Раскладка по умолчанию: «О проекте» — отдельной областью слева,
 *  остальные вкладки — справа (активная справа — «Структура»). */
export const PROJECT_DEFAULT_GROUPS: readonly (readonly string[])[] = [
  ['about'],
  PROJECT_TAB_IDS.filter((id) => id !== 'about'),
];
