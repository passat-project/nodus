import { useCallback, useEffect, useState } from 'react';

import { clearRecentSearches, loadRecentSearches, pushRecentSearch } from './search-recent.js';

/** Недавние запросы текущего пользователя: локальный список + запись при
 *  открытии результата. Смена пользователя перечитывает свой ключ. */
export function useRecentSearches(userId: string | null | undefined) {
  const [items, setItems] = useState<string[]>(() => loadRecentSearches(userId));

  useEffect(() => {
    setItems(loadRecentSearches(userId));
  }, [userId]);

  const push = useCallback((query: string) => setItems(pushRecentSearch(userId, query)), [userId]);
  const clear = useCallback(() => {
    clearRecentSearches(userId);
    setItems([]);
  }, [userId]);

  return { items, push, clear };
}
