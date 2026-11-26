/**
 * Легаси-адрес «Схемы проектов» → единый вход «Процессы» (#857): вкладка
 * удалена из реестра навигации, старые ссылки (закладки, «Настроить типы
 * папок» из структуры проекта) нормализуются редиректом в `beforeLoad`
 * маршрута /automation. Маппинг: `type` → `ptype`, `kind` → `ftype`.
 */
export function legacyProjectSchemasSearch(
  search: Record<string, unknown>,
): Record<string, unknown> | null {
  if (search.tab !== 'project-schemas') return null;
  const next: Record<string, unknown> = { ...search, tab: 'processes' };
  delete next.type;
  delete next.kind;
  if (typeof search.type === 'string' && search.type) next.ptype = search.type;
  if (typeof search.kind === 'string' && search.kind) next.ftype = search.kind;
  return next;
}
