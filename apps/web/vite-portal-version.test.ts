import { describe, expect, it, vi } from 'vitest';

const { readdirMock } = vi.hoisted(() => ({ readdirMock: vi.fn() }));
vi.mock('node:fs', () => ({ readdirSync: (dir: unknown) => readdirMock(dir) }));

// config()-хук читает env через loadEnv (в т.ч. process.env): случайная
// переменная машины не должна ломать детерминизм тестов.
delete process.env.VITE_PORTAL_VERSION;

const { portalVersionAssets, resolvePortalVersion } = await import('./vite-portal-version.js');

/**
 * Плагин версии портала (#1038): приоритет env → релизы → '0.0.0', define
 * `__PORTAL_VERSION__`, `/version.json` в dev-middleware и в эмите сборки.
 * Папка релизов замокана — тест не зависит от текущего номера выпуска.
 */

/** Vite 8 hook = function | { handler }: распаковка для вызова в тесте. */
function hookOf(h: unknown): ((...args: never[]) => unknown) | undefined {
  if (typeof h === 'function') return h as (...args: never[]) => unknown;
  const handler = (h as { handler?: unknown } | null | undefined)?.handler;
  return typeof handler === 'function' ? (handler as (...args: never[]) => unknown) : undefined;
}

/** config() заполняет версию замыкания плагина (нужен до dev/emit-хуков). */
function configured(releaseFiles: string[]): ReturnType<typeof portalVersionAssets> {
  readdirMock.mockReturnValue(releaseFiles);
  const plugin = portalVersionAssets();
  hookOf(plugin.config)?.({ envDir: '.' } as never, { command: 'serve', mode: 'test' } as never);
  return plugin;
}

describe('resolvePortalVersion (#1038)', () => {
  it('env VITE_PORTAL_VERSION — полный приоритет, с тримом; пустая строка = не задана', () => {
    expect(resolvePortalVersion('1.2.3')).toBe('1.2.3');
    expect(resolvePortalVersion('  9.0.0\n')).toBe('9.0.0');
    readdirMock.mockReturnValue(['0.16.0.json']);
    expect(resolvePortalVersion('   ')).toBe('0.16.0');
    expect(resolvePortalVersion(undefined)).toBe('0.16.0');
  });

  it('без env — максимум semver из имён файлов (числом, не строкой)', () => {
    readdirMock.mockReturnValue([
      '0.1.0.json',
      '0.9.0.json',
      '0.10.0.json',
      '0.16.0.json',
      'README.md',
      '0.16.0.json.tmp',
      'v0.99.0.json',
    ]);
    expect(resolvePortalVersion(undefined)).toBe('0.16.0');
  });

  it('пустая папка / один мусор → 0.0.0', () => {
    readdirMock.mockReturnValue([]);
    expect(resolvePortalVersion(undefined)).toBe('0.0.0');
    readdirMock.mockReturnValue(['README.md', 'draft.json']);
    expect(resolvePortalVersion(undefined)).toBe('0.0.0');
  });
});

describe('portalVersionAssets: хуки плагина (#1038)', () => {
  it('config() добавляет define __PORTAL_VERSION__ с версией релизов', () => {
    const plugin = configured(['0.9.0.json', '0.10.0.json']);
    const patch = hookOf(plugin.config)?.(
      { envDir: '.' } as never,
      { command: 'serve', mode: 'test' } as never,
    ) as {
      define?: Record<string, string>;
    };
    expect(patch?.define?.__PORTAL_VERSION__).toBe('"0.10.0"');
  });

  it('generateBundle() эмитит version.json в корень dist', () => {
    const plugin = configured(['0.16.0.json']);
    const emitted: { fileName: string; source: string }[] = [];
    hookOf(plugin.generateBundle)?.call(
      {
        emitFile: (f: { fileName: string; source: string }) => {
          emitted.push({ fileName: f.fileName, source: f.source });
        },
      } as never,
      {} as never,
    );
    expect(emitted).toEqual([{ fileName: 'version.json', source: '{"version":"0.16.0"}' }]);
  });

  it('dev: /version.json отдаётся как JSON no-store, чужой путь — next()', () => {
    const plugin = configured(['0.16.0.json']);
    const server: {
      middlewares: { use: (fn: (req: unknown, res: unknown, next: () => void) => void) => void };
      handler: ((req: unknown, res: unknown, next: () => void) => void) | null;
    } = { middlewares: { use: () => undefined }, handler: null };
    server.middlewares.use = (fn) => {
      server.handler = fn;
    };
    hookOf(plugin.configureServer)?.(server as never);

    const res = {
      headers: {} as Record<string, string>,
      setHeader: (k: string, v: string) => {
        res.headers[k] = v;
      },
      end: (b?: string) => {
        res.body = b ?? null;
      },
      body: null as string | null,
    };
    let passed = false;
    server.handler!({ url: '/version.json?t=1' }, res, () => {
      passed = true;
    });
    expect(passed).toBe(false);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toBe('{"version":"0.16.0"}');

    let forwarded = false;
    server.handler!({ url: '/api/v1/letters' }, {} as never, () => {
      forwarded = true;
    });
    expect(forwarded).toBe(true);
  });
});
