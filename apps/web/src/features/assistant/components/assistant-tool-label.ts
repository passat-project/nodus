/**
 * Человекочитаемая подпись вызова инструмента в ленте ассистента.
 *
 * События/БД несут `title`, но старые прогоны и fallback могли оставить сырой
 * id (`ext.exa.web_search_exa`) — после выполнения строка «превращалась в
 * английские термины» (замечание владельца 18.11). Поэтому подпись всегда
 * нормализуется на клиенте: если title отсутствует или совпадает с id,
 * выводим понятное название. Портальные id (tasks.list) уже приходят с
 * человеческим title из каталога и не трогаются.
 */
export function assistantToolLabel(toolId: string, title?: string | null): string {
  if (title && title !== toolId) return title;
  if (toolId.startsWith('ext.')) {
    const parts = toolId.split('.');
    const tool = parts.at(-1) ?? toolId;
    if (tool === 'web_search_exa') return 'Интернет: поиск';
    if (tool === 'web_fetch_exa') return 'Интернет: страница';
    const server = (parts[1] ?? '').replace(/-/g, ' ');
    return server ? `${server}: ${tool}` : `Внешний инструмент: ${tool}`;
  }
  return title ?? toolId;
}
