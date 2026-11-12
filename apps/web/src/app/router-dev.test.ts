// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { router } from './router.js';

/**
 * Dev-галерея `/dev/ui` (#257): маршрут есть в dev-режиме и в сборке песочницы
 * (`VITE_SANDBOX_DEV_UI=1`), в прод-сборке его нет — флаг статичен, чанк
 * вырезается (доказательство — grep по `apps/web/dist` в гейтах задачи).
 *
 * Ветки проверяются подменой env + сбросом модулей: условие в router.tsx —
 * инлайн-выражение (вызов функции свернуть нельзя, иначе чанк остаётся в
 * проде), поэтому проверяем именно его, а не отдельный хелпер.
 *
 * Флаг песочницы стабится ЯВНО в каждом кейсе (включая первый): иначе тест
 * зависел бы от окружения машины/CI, где переменная может быть выставлена.
 */
describe('router: dev-галерея', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SANDBOX_DEV_UI', '0');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('dev-режим (DEV=true): маршрут зарегистрирован', () => {
    expect(import.meta.env.DEV).toBe(true);
    expect(import.meta.env.VITE_SANDBOX_DEV_UI).toBe('0');
    expect(Object.keys(router.routesByPath)).toContain('/dev/ui');
  });

  it('без dev-режима и без флага: маршрут НЕ регистрируется', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SANDBOX_DEV_UI', '0');
    const { router: prodRouter } = await import('./router.js');
    expect(Object.keys(prodRouter.routesByPath)).not.toContain('/dev/ui');
  });

  it('без dev-режима, но с флагом песочницы: маршрут зарегистрирован', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SANDBOX_DEV_UI', '1');
    const { router: sandboxRouter } = await import('./router.js');
    expect(Object.keys(sandboxRouter.routesByPath)).toContain('/dev/ui');
  });

  it('флаг песочницы строгий: «0» и «true» маршрут не включают', async () => {
    for (const value of ['0', 'true']) {
      vi.resetModules();
      vi.stubEnv('DEV', false);
      vi.stubEnv('VITE_SANDBOX_DEV_UI', value);
      const { router: offRouter } = await import('./router.js');
      expect(Object.keys(offRouter.routesByPath), value).not.toContain('/dev/ui');
    }
  });
});
