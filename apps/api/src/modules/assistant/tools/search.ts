import { searchCatalog } from './retrieval.js';
import type { AssistantToolDefinition } from './tool-definition.js';

/**
 * Лексический поиск по каталогу (ADR-0043 п. 4, «вторая полка»): когда нужного
 * инструмента нет в горячем наборе, модель зовёт `tools.search`, и поиск
 * подбирает инструменты по смыслу запроса.
 *
 * Алгоритм — в `retrieval.ts` (#926): один скорер с диспетчером и eval,
 * чтобы «нашлось поиском» и «выбрал диспетчер» не расходились. Эмбеддинги —
 * следующая фаза (ядро #272).
 */
export function searchTools(
  catalog: readonly AssistantToolDefinition[],
  query: string,
  limit = 5,
): AssistantToolDefinition[] {
  return searchCatalog(catalog, query, limit);
}
