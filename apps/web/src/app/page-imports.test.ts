// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PAGE_IMPORTS, pageImportForPath, preloadPage } from './page-imports.js';
import { router } from './router.js';

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
    expect(router.options.defaultPreload).toBe('intent');
  });

  it('провал предзагрузки не рвёт страницу: перезагрузит guard роутера при входе', async () => {
    const failing = vi.spyOn(PAGE_IMPORTS, 'login').mockRejectedValue(new Error('404'));

    await expect(preloadPage('/login')).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('предзагрузка корня ничего не грузит', async () => {
    const anyLoad = vi.spyOn(PAGE_IMPORTS, 'home');
    await preloadPage('/');
    expect(anyLoad).not.toHaveBeenCalled();
  });
});
