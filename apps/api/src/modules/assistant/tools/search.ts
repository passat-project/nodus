import type { AssistantToolDefinition } from './tool-definition.js';

/**
 * Лексический поиск по каталогу (ADR-0043 п. 4, «вторая полка»): когда нужного
 * инструмента нет в горячем наборе, модель зовёт `tools.search`, и поиск
 * подбирает инструменты по имени, заголовку, описанию и ключевым словам.
 * Эмбеддинги и диспетчер — следующая фаза (ядро #272): здесь достаточно
 * точного и объяснимого совпадения.
 */

/** Нормализация: нижний регистр, ё→е, обрезка пунктуации. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ');
}

/** Слова запроса без шума: односимвольные токены не считаем. */
function tokens(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

/** Оценка инструмента: точное совпадение имени весит больше описания. */
function score(tool: AssistantToolDefinition, requestTokens: readonly string[]): number {
  const id = normalize(tool.id);
  const title = normalize(tool.title);
  const description = normalize(tool.description);
  const keywords = tool.keywords.map(normalize);
  let total = 0;
  for (const token of requestTokens) {
    if (id.includes(token)) total += 8;
    if (title.includes(token)) total += 5;
    if (keywords.some((keyword) => keyword.includes(token) || token.includes(keyword))) total += 4;
    if (description.includes(token)) total += 2;
  }
  return total;
}

/**
 * Поиск по каталогу: инструменты с положительной оценкой, по убыванию.
 * Сортировка при равных оценках — по id (детерминированно: тесты и промпт
 * не дрожат между вызовами).
 */
export function searchTools(
  catalog: readonly AssistantToolDefinition[],
  query: string,
  limit = 5,
): AssistantToolDefinition[] {
  const requestTokens = tokens(query);
  if (requestTokens.length === 0) return [];
  return catalog
    .map((tool) => ({ tool, score: score(tool, requestTokens) }))
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id))
    .slice(0, Math.max(1, limit))
    .map((ranked) => ranked.tool);
}
