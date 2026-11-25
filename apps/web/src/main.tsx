import '@nodus/ui/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { initPreloadErrorReload } from './app/chunk-reload.js';
import { getApiMockConfig } from './shared/api/api-mock-config.js';

// Старая вкладка сломалась после пересборки (#1038 — расширение guard'а
// роутера #88 на ВСЕ dynamic import'ы): Vite эмитит `vite:preloadError`
// на window при провале modulepreload (доки:
// https://vite.dev/guide/build#vitepreloaderror). Регистрируется ДО
// рендера — успевает поймать и импорты стартового графа.
initPreloadErrorReload();

/** MSW (ADR-0001, #48): воркер стартует ДО рендера, только если есть
 *  мокаемые домены: VITE_API_MOCK=true — демо целиком, список —
 *  покомпонентный режим, false/пусто — живой API без воркера. */
async function enableMocking(): Promise<void> {
  if (!getApiMockConfig().enabled) {
    // Прошлые мок-сборки оставили service worker на этом origin — снимаем
    // регистрацию, чтобы живой режим не шёл через бездействующий SW-прокси.
    navigator.serviceWorker
      ?.getRegistration('/mockServiceWorker.js')
      .then((registration) => registration?.unregister())
      .catch(() => undefined);
    return;
  }
  const { worker } = await import('./app/msw-browser.js');
  // Шумим только по нашим /api/*: посторонние запросы (антивирус, devtools)
  // молча пропускаем — иначе консоль засорена предупреждениями «нет хендлера».
  await worker.start({
    onUnhandledRequest: (req, print) => {
      if (new URL(req.url).pathname.startsWith('/api/')) print.warning();
    },
  });
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Точка монтирования #root не найдена');
}

// Рендер — В ЛЮБОМ случае: упавший MSW-воркер (не зарегистрировался,
// чанк не загрузился) не должен давать белую страницу — приложение
// поднимется без моков, причина — в консоли.
void enableMocking()
  .catch((error: unknown) => {
    console.error('[nodus] MSW не запустился — приложение стартует без моков', error);
  })
  .then(() => {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
