/**
 * Перезагрузка страницы — кнопка «Обновить» плашки обновления портала
 * (#1038, фаза F). Отдельный модуль — точка подмены в тестах: window.location
 * в jsdom LegacyUnforgeable (reload не подменяется ни spyOn, ни defineProperty).
 */
export function reloadPortal(): void {
  window.location.reload();
}
