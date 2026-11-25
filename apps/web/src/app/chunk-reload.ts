/**
 * Гибель чанков после пересборки (#88, #1038): старая вкладка грузит
 * dynamic import с хэшем, которого на сервере уже нет (404) — раздел «не
 * открывается». Семантика одного reload'а (против цикла перезагрузок):
 * первый неуспех — reload страницы за сессионный флаг (после выкатки
 * index.html уже ссылается на свежие чанки), успешная загрузка флаг
 * снимает, повторный неуспех — честная ошибка вызывающему.
 *
 * Потребители: `pageLoader` роутера (ошибки импорта страниц) и слушатель
 * `vite:preloadError` в точке входа (провалы modulepreload вне роутера);
 * общий флаг делает их идемпотентными — кто первый заметил, тот и
 * перезагружает, второй вызов цикла не создаёт.
 */
const CHUNK_RELOAD_KEY = 'nodus-chunk-reload';

/** Успешная загрузка чанка: цепочка «ошибка → reload → успех» завершена. */
export function markChunkLoaded(): void {
  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
}

/**
 * Ошибка загрузки чанка: перезагрузить страницу ОДИН раз за сессию.
 * Повторный неуспех (сервер реально недоступен) — reload не запускаем,
 * флаг снимаем (следующая навигация начинает цикл заново), решение за
 * вызывающим — показать честную ошибку.
 *
 * @param reload действие перезагрузки (параметр — точка подмены в тестах:
 *   `window.location` в jsdom LegacyUnforgeable, spyOn невозможен).
 * @returns true — reload запущен (вызывающему остаётся не резолвить
 *   обещание, чтобы Suspense не мигнул ошибкой до навигации).
 */
export function reloadOnceOnChunkError(
  reload: () => void = () => window.location.reload(),
): boolean {
  if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    reload();
    return true;
  }
  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  return false;
}

/**
 * Глобальный слушатель `vite:preloadError` (точка входа main.tsx): Vite
 * эмитит событие на window при провале modulepreload/dynamic import
 * (доки: https://vite.dev/guide/build#vitepreloaderror). `preventDefault`
 * гасит бросок исходной ошибки Vite (ошибка доходит до UI через
 * обещание импорта — pageLoader/RouterErrorScreen), дальше — общая
 * семантика одного reload'а.
 */
export function initPreloadErrorReload(reload: () => void = () => window.location.reload()): void {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadOnceOnChunkError(reload);
  });
}
