/** Недавние запросы поиска (#952): localStorage на пользователя — чужой
 *  сотрудник на том же компьютере не видит историю запросов (AUD-005, как
 *  черновики чата и настройки вида). Максимум 8, новые сверху, дубликаты
 *  без учёта регистра схлопываются. */
const KEY_PREFIX = 'nodus-search-recent-v1:';
const LIMIT = 8;

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function safeParse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function loadRecentSearches(userId: string | null | undefined): string[] {
  if (!userId || typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(storageKey(userId)));
}

export function pushRecentSearch(userId: string | null | undefined, query: string): string[] {
  const value = query.trim();
  if (!userId || typeof window === 'undefined' || value.length < 2) {
    return loadRecentSearches(userId);
  }
  const current = loadRecentSearches(userId);
  const deduped = current.filter((item) => item.toLowerCase() !== value.toLowerCase());
  const next = [value, ...deduped].slice(0, LIMIT);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // Переполненный/запрещённый localStorage не ломает поиск — подсказка
    // просто не сохранится.
  }
  return next;
}

export function clearRecentSearches(userId: string | null | undefined): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // см. pushRecentSearch
  }
}
