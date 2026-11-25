import { prefetchPersonalBoard } from '../../features/tasks/api/tasks-board-prefetch.js';
import { queryClient } from '../../shared/lib/query-client.js';
import { PAGE_IMPORTS, type PageImportKey } from '../page-imports.js';
import { useUiPrefsStore } from '../../shared/preferences/ui-prefs-store.js';
import { RAIL_MODULES, type NavModuleDef } from './nav-registry.js';
import { resolveHidden, resolveOrder } from './ui-prefs.js';

/**
 * Фоновый прогрев разделов (#1051). Страница раздела — отдельный чанк, и
 * ПЕРВЫЙ после обновления страницы заход в каждый раздел ждал его загрузки и
 * разбора. Оболочка после входа в свободное время (по одному,
 * `requestIdleCallback`) грузит чанки видимых модулей рейки в личном порядке,
 * последним — движок PDF (письма открываются PDF-копией): клик по разделу и
 * первый документ больше не ждут сети.
 *
 * Границы. Экономия трафика (Data Saver, сети 2G) — чанки придут по клику.
 * Ошибка импорта глотается: после выкатки старый чанк даёт 404, и фоновый
 * прогрев не должен перезагружать страницу под руками — при реальном входе в
 * раздел это делает штатный guard роутера.
 */

export type WarmupKey = PageImportKey | 'pdf';

/** Движок PDF — отдельный чанк (`shared/files/file-viewer-body.ts`). */
const PDF_VIEWER_IMPORT = () => import('../../shared/files/pdf-viewer.js');

/** Пауза до первого чанка: стартовые запросы открытого раздела идут без
 *  конкуренции за канал. */
const FIRST_DELAY_MS = 1_500;
/** Запрос отменяется не позже: простоя может не быть под непрерывным вводом. */
const IDLE_TIMEOUT_MS = 4_000;
const SLOW_NETWORKS = new Set(['slow-2g', '2g']);

export interface WarmupEnv {
  /** Следующий свободный момент браузера. */
  idle: () => Promise<void>;
  /** Трафик не экономят и сеть не медленная. */
  allowed: () => boolean;
  /** Загрузить чанк; отказ — наружу (глотает прогрев). */
  load: (key: WarmupKey) => Promise<unknown>;
  /** Данные раздела в кэш — после чанка; не заданы — ничего. */
  data?: (key: WarmupKey) => Promise<unknown>;
}

/** Что грузить: страницы видимых модулей в личном порядке, последним — PDF. */
export function warmupPlan(navOrder?: string[], navHidden?: string[]): WarmupKey[] {
  const ids = RAIL_MODULES.map((m: NavModuleDef) => m.id);
  const pages = resolveOrder(ids, navOrder)
    .filter((id) => !resolveHidden(ids, navHidden).includes(id))
    .map((id) => RAIL_MODULES.find((m) => m.id === id)?.page)
    .filter((page): page is PageImportKey => Boolean(page));
  return [...new Set<WarmupKey>([...pages, 'pdf'])];
}

/** Прогрев по плану: чанк — только в свободный момент, по одному за раз. */
export async function runModuleWarmup(env: WarmupEnv): Promise<void> {
  if (!env.allowed()) return;
  const { navOrder, navHidden } = useUiPrefsStore.getState().personal;
  for (const key of warmupPlan(navOrder, navHidden)) {
    await env.idle();
    try {
      await env.load(key);
    } catch {
      /* чанк устарел — перезагрузит guard роутера при реальном входе */
    }
    // Данные раздела грузятся и при устаревшем чанке: страница следующей
    // сборки возьмёт их из кэша. Отказ глотается — страница спросит сама.
    await env.data?.(key).catch(() => undefined);
  }
}

/** Данные разделов, которые стоит иметь в кэше до клика: раздел → запросы. */
const DATA_WARMUP: Partial<Record<WarmupKey, () => Promise<unknown>>> = {
  tasks: () => prefetchPersonalBoard(queryClient),
};

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/** Экономия трафика (Data Saver) и сети 2G — чанки придут по клику. */
export function networkAllowsWarmup(connection: NetworkInformation | undefined): boolean {
  return !(connection?.saveData || SLOW_NETWORKS.has(connection?.effectiveType ?? ''));
}

/** Трафик не экономят и сеть не медленная — в этом браузере сейчас. */
export function browserAllowsWarmup(): boolean {
  return networkAllowsWarmup(
    (navigator as Navigator & { connection?: NetworkInformation }).connection,
  );
}

/** Среда браузера: реальная пауза, реальный простой, реальные импорты. */
export function browserEnv(): WarmupEnv {
  let first = true;
  return {
    async idle() {
      if (first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, FIRST_DELAY_MS));
      }
      return new Promise<void>((resolve) => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
        } else {
          setTimeout(resolve, IDLE_TIMEOUT_MS / 8);
        }
      });
    },
    allowed: browserAllowsWarmup,
    load: (key) => (key === 'pdf' ? PDF_VIEWER_IMPORT() : PAGE_IMPORTS[key]()),
    data: (key) => DATA_WARMUP[key]?.() ?? Promise.resolve(),
  };
}

let started = false;

/** Запуск из оболочки (один раз за страницу). */
export function startModuleWarmup(): Promise<void> {
  if (started) return Promise.resolve();
  started = true;
  return runModuleWarmup(browserEnv());
}
