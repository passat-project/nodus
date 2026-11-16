/**
 * Хранилище сохранённых фильтров списков (use-list-toolbar): прямой
 * localStorage, отдельного стора нет. Ключ привязан к пользователю —
 * на общем компьютере фильтры одного сотрудника не применяются другому
 * (AUD-005); общий слой без пользователя больше не читается.
 */
const STORAGE_PREFIX = 'nodus-list-filters-v1';

export function listFiltersStorageKey(userId: string | null, viewKey: string): string {
  return `${STORAGE_PREFIX}:${userId ?? 'anonymous'}:${viewKey}`;
}

/** Удалить сохранённые фильтры завершившейся сессии. legacy-ключи формы
 *  `nodus-list-filters-v1:<view>` (без пользователя) тоже убираются: они
 *  больше не читаются, но личные данные в них остались. */
export function clearSavedListFilters(userId: string | null): void {
  try {
    const scopedPrefix = userId ? `${STORAGE_PREFIX}:${userId}:` : null;
    const legacyPrefix = `${STORAGE_PREFIX}:`;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(legacyPrefix)) continue;
      const rest = key.slice(legacyPrefix.length);
      const legacy = !rest.includes(':');
      if ((scopedPrefix && key.startsWith(scopedPrefix)) || legacy) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // localStorage недоступен (приватный режим) — сбрасывать нечего.
  }
}
