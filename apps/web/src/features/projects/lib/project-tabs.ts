import { useState } from 'react';

/** Вкладки рабочей зоны карточки проекта (#467): «Структура» — ПЕРВОЙ в
 *  реестре (дерево узлов-папок с задачами-листьями); «Задачи», «Канал»,
 *  «Участники», «История». «Чат проекта» появится вместе с пространством
 *  проекта (#456) — до него вкладки нет. */
export type ProjectTabId = 'structure' | 'tasks' | 'channel' | 'members' | 'history';

/** Порядок вкладок; первичная не скрывается (рабочая зона не может остаться
 *  пустой). Персональный порядок и DnD — следующий шаг. */
export const PROJECT_TAB_IDS: readonly ProjectTabId[] = [
  'structure',
  'tasks',
  'channel',
  'members',
  'history',
];

const STORAGE_KEY = 'nodus-project-tabs-v2';

/** Первичная вкладка (вердикт владельца 04.11.2026): всегда «Структура» —
 *  первая вкладка реестра; карточка проекта открывается на ней. */
export function primaryTab(): ProjectTabId {
  return 'structure';
}

function isTabId(value: unknown): value is ProjectTabId {
  return typeof value === 'string' && PROJECT_TAB_IDS.includes(value as ProjectTabId);
}

/** Скрытые пользователем вкладки из памяти (неизвестные ключи и первичная
 *  вкладка отбрасываются — первичную скрыть нельзя). */
export function readHiddenTabs(raw: string | null, primary: ProjectTabId): ProjectTabId[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is ProjectTabId => isTabId(id) && id !== primary);
  } catch {
    return [];
  }
}

/** Видимые вкладки в порядке реестра; первичная — всегда видима. */
export function visibleTabs(
  tabs: readonly ProjectTabId[],
  hidden: readonly ProjectTabId[],
  primary: ProjectTabId,
): ProjectTabId[] {
  return tabs.filter((id) => id === primary || !hidden.includes(id));
}

/** Персональная видимость вкладок (память в localStorage, как у полей
 *  паспорта): «+» в полосе вкладок управляет набором. */
export function useProjectTabs(primary: ProjectTabId = 'structure') {
  const [hidden, setHidden] = useState<ProjectTabId[]>(() =>
    readHiddenTabs(localStorage.getItem(STORAGE_KEY), primary),
  );

  function toggle(id: ProjectTabId) {
    if (id === primary) return;
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return { hidden, toggle, visible: visibleTabs(PROJECT_TAB_IDS, hidden, primary) };
}
