import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv, type Plugin } from 'vite';

/**
 * Версия портала, вшиваемая в сборку (#1038, фаза A): источник define
 * `__PORTAL_VERSION__` и `version.json` в корне раздачи (лёгкий, без дат и
 * текстов) — по нему открытая вкладка детектит редеплой (фича
 * `src/features/portal-update`). Приоритет: env `VITE_PORTAL_VERSION`
 * (явная подмена, например песочницей) → максимум semver из имён
 * `whats-new/releases/<X.Y.Z>.json` (имя файла = версия = тег на main) →
 * '0.0.0'. Вычисляется на этапе конфигурации, не в рантайме: файл знает
 * версию сборки ещё до первого бандла; dev отдаёт middleware, build эмитит
 * в dist (preview/live-stack раздают dist — файл появляется сам).
 */

/** Папка выпусков «Что нового» — единственный источник версии репозитория. */
const RELEASES_DIR = fileURLToPath(new URL('./src/features/whats-new/releases', import.meta.url));
const RELEASE_NAME_RE = /^(\d+)\.(\d+)\.(\d+)\.json$/;

type Parts = readonly [number, number, number];

function toParts(match: RegExpExecArray): Parts {
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isGreater(a: Parts, b: Parts): boolean {
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Максимум из имён файлов выпусков; сравнение числовое, не строковое
 *  (`0.10.0` > `0.9.0`). Пусто/мусор → '0.0.0'. */
function maxReleaseVersion(): string {
  let max: Parts | null = null;
  for (const name of readdirSync(RELEASES_DIR)) {
    const match = RELEASE_NAME_RE.exec(name);
    if (!match) continue;
    const parts = toParts(match);
    if (max === null || isGreater(parts, max)) max = parts;
  }
  return max === null ? '0.0.0' : max.join('.');
}

/** Env (полный приоритет, пустая строка = не задана) → релизы → '0.0.0'. */
export function resolvePortalVersion(envVersion: string | undefined): string {
  const fromEnv = envVersion?.trim();
  if (fromEnv) return fromEnv;
  return maxReleaseVersion();
}

/** Общий JSON обеих сторон плагина (dev-мiddleware и asset сборки). */
function versionJson(version: string): string {
  return `{"version":${JSON.stringify(version)}}`;
}

/**
 * Плагин Vite: define `__PORTAL_VERSION__` (config), `/version.json` в dev
 * (configureServer, middleware до внутренностей vite) и в dist
 * (generateBundle, корень).
 */
export function portalVersionAssets(): Plugin {
  let version = '0.0.0';
  return {
    name: 'nodus-portal-version',
    config(userConfig, { mode }) {
      // envDir — из конфига приложения (переменные лежат в корневом .env
      // монорепо, как NODUS_*; пустой префикс — тот же вызов, что в config).
      const env = loadEnv(mode, userConfig.envDir ?? '.', '');
      version = resolvePortalVersion(env.VITE_PORTAL_VERSION);
      return { define: { __PORTAL_VERSION__: JSON.stringify(version) } };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== '/version.json') {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        // Всегда свежий: файл — датчик редеплоя, кэш съел бы его смысл.
        res.setHeader('Cache-Control', 'no-store');
        res.end(versionJson(version));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: versionJson(version),
      });
    },
  };
}
