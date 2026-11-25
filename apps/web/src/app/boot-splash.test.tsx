// @vitest-environment jsdom
import type { ReactNode } from 'react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOOT_SPLASH_ID, removeBootSplash } from './boot-splash.js';
import indexHtml from '../../index.html?raw';
import { RootGate } from './router.js';
import { LogoIcon } from './shell/logo-icon.js';
import { NotFoundScreen, RouterErrorScreen } from './shell/system-screens.js';

/**
 * Стартовая заставка (#1051): держится на экране всю загрузку скриптов и
 * вход вместо белого листа. Опасность обратной стороны — заставку забыли
 * снять, и портал «не открывается»: каждый первый экран обязан её убрать.
 */

function mountSplash(): HTMLElement {
  const splash = document.createElement('div');
  splash.id = BOOT_SPLASH_ID;
  document.body.prepend(splash);
  return splash;
}

function testRouterWith(component: () => ReactNode) {
  const root = createRootRoute({ component: component as never });
  const testRouter = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={testRouter as never} />;
}

/** Корневая рамка приложения с дочерней страницей. */
function appRoot() {
  const root = createRootRoute({ component: RootGate });
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <p>Страница раздела</p>,
  });
  const testRouter = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={testRouter as never} />;
}

describe('boot-splash: стартовая заставка (#1051)', () => {
  afterEach(() => {
    removeBootSplash();
  });

  it('index.html держит заставку с тем же id рядом с #root — не внутри него', () => {
    const splashAt = indexHtml.indexOf(`id="${BOOT_SPLASH_ID}"`);
    const rootAt = indexHtml.indexOf('id="root"');
    expect(splashAt).toBeGreaterThan(0);
    expect(splashAt).toBeLessThan(rootAt);
    // Скрипт текущей темы стоит в <head> до стилей заставки: цвет фона — токен темы.
    expect(indexHtml.indexOf("dataset.theme = 'dark'")).toBeLessThan(splashAt);
    expect(indexHtml).toMatch(/#nodus-boot-splash\s*\{[^}]*var\(--background/);
  });

  it('знак на заставке — тот же, что LogoIcon оболочки (разметка в index.html дублем, без импорта)', () => {
    const shape = (svg: Element | null) =>
      [...(svg?.querySelectorAll('line, polygon, circle') ?? [])]
        .map((el) =>
          [
            el.tagName,
            ...['x1', 'y1', 'x2', 'y2', 'points', 'cx', 'cy', 'r'].map((name) =>
              el.getAttribute(name),
            ),
          ].join(','),
        )
        .join('|');
    const splashMark = new DOMParser()
      .parseFromString(indexHtml, 'text/html')
      .querySelector(`#${BOOT_SPLASH_ID} svg`);
    const { container } = render(<LogoIcon className="size-9" />);
    expect(shape(splashMark)).toBe(shape(container.querySelector('svg')));
    expect(shape(splashMark)).toContain('polygon');
  });

  it('корневая рамка роутера снимает заставку при первой покраске', async () => {
    const splash = mountSplash();
    render(appRoot());
    await screen.findByText('Страница раздела');
    await waitFor(() => expect(splash.isConnected).toBe(false));
  });

  it('экран ошибки роутера заменяет корневую рамку — заставку снимает сам', async () => {
    const splash = mountSplash();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      testRouterWith(() => (
        <RouterErrorScreen error={new Error('auth bootstrap: сервер недоступен')} />
      )),
    );
    expect(await screen.findByRole('button', { name: 'Обновить страницу' })).toBeTruthy();
    expect(splash.isConnected).toBe(false);
    consoleError.mockRestore();
  });

  it('экран «не найдено» — тоже', async () => {
    const splash = mountSplash();
    render(testRouterWith(() => <NotFoundScreen />));
    await screen.findByRole('link');
    expect(splash.isConnected).toBe(false);
  });

  it('повторный вызов и отсутствие заставки — не ошибка', () => {
    expect(() => removeBootSplash()).not.toThrow();
  });

  it('страховка: скрипты не дошли — заставку снимает таймер в index.html', () => {
    vi.useFakeTimers();
    try {
      const splash = mountSplash();
      const safety = indexHtml.match(
        /<script>([^<]*getElementById\('nodus-boot-splash'\)[^<]*)<\/script>/,
      );
      expect(safety).not.toBeNull();
      new Function(safety![1]!)();
      vi.advanceTimersByTime(14_999);
      expect(splash.isConnected).toBe(true);
      vi.advanceTimersByTime(1);
      expect(splash.isConnected).toBe(false);
      // Повторный тик (второй запуск скрипта) — не ошибка: заставки уже нет.
      expect(() => new Function(safety![1]!)()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
