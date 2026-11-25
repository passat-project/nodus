// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PAGE_IMPORTS, pageImportForPath, preloadPage } from './page-imports.js';
import { pageLoader, router, type PreloadablePage } from './router.js';

/**
 * Чанк раздела грузится заранее — при обновлении страницы (параллельно входу)
 * и по наведению на раздел (#1051). Таблица адресов обязана покрывать все
 * маршруты роутера: непокрытый раздел ждал бы загрузки чанка после входа.
 */
describe('page-imports: адрес раздела → его чанк (#1051)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('каждый маршрут роутера находит свой импорт; корень и неизвестный путь — нет', () => {
    // Корень — переадресация без страницы; dev-галерея в прод-сборку не входит.
    const skip = new Set(['/', '/dev/ui']);
    const paths = Object.keys(router.routesByPath).filter((path) => !skip.has(path));
    expect(paths.length).toBeGreaterThan(5);
    for (const path of paths) {
      const probe = path.replace(/\$[a-zA-Z]+/g, 'x1');
      expect(pageImportForPath(probe), path).not.toBeNull();
    }
    expect(pageImportForPath('/')).toBeNull();
    expect(pageImportForPath('/unknown-section')).toBeNull();
  });

  it('вложенный адрес раздела — тот же чанк', () => {
    expect(pageImportForPath('/chat/abc-123')).toBe(PAGE_IMPORTS.chat);
    expect(pageImportForPath('/tasks?view=list')).toBe(PAGE_IMPORTS.tasks);
  });

  it('по наведению на раздел чанк грузится до клика', () => {
    // Роутер вызывает component.preload?.() и молча пропускает страницы без него
    // (router-core, load-client.ts); у React.lazy такого метода нет — «intent»
    // без preload ничего не грузил. Любая lazy-страница обязана его иметь.
    expect(router.options.defaultPreload).toBe('intent');
    const lazyPages = Object.values(router.routesById).filter(
      (route) =>
        (route.options.component as { $$typeof?: symbol } | undefined)?.$$typeof ===
        Symbol.for('react.lazy'),
    );
    expect(lazyPages.length).toBeGreaterThan(5);
    for (const route of lazyPages) {
      const page = route.options.component as PreloadablePage;
      expect(typeof page.preload, route.id).toBe('function');
    }
  });

  it('pageLoader: наведение и рендер ждут один импорт; провал предзагрузки не копится', async () => {
    const importer = vi.fn(async () => ({ default: () => null }));
    const Page = pageLoader(importer);
    await Page.preload();
    await Page.preload();
    expect(importer).toHaveBeenCalledTimes(1);

    // Флаг guard стоит — перезагрузки не будет; ошибка проглочена, попытка повторяется.
    sessionStorage.setItem('nodus-chunk-reload', '1');
    const flaky = vi
      .fn<() => Promise<{ default: () => null }>>()
      .mockRejectedValueOnce(new Error('сеть'))
      .mockResolvedValue({ default: () => null });
    const Flaky = pageLoader(flaky);
    await expect(Flaky.preload()).resolves.toBeUndefined();
    await Flaky.preload();
    expect(flaky).toHaveBeenCalledTimes(2);
    sessionStorage.removeItem('nodus-chunk-reload');
  });

  it('провал предзагрузки не рвёт страницу: перезагрузит guard роутера при входе', async () => {
    const failing = vi.spyOn(PAGE_IMPORTS, 'login').mockRejectedValue(new Error('404'));

    await expect(preloadPage('/login')).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('каждый импорт таблицы разрешается модулем страницы', async () => {
    for (const [key, load] of Object.entries(PAGE_IMPORTS)) {
      const module = await load();
      expect(typeof module.default, key).toBe('function');
    }
  });

  it('предзагрузка корня ничего не грузит', async () => {
    const anyLoad = vi.spyOn(PAGE_IMPORTS, 'home');
    await preloadPage('/');
    expect(anyLoad).not.toHaveBeenCalled();
  });
});
