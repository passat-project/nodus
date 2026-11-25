// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initPreloadErrorReload, markChunkLoaded, reloadOnceOnChunkError } from './chunk-reload.js';

/**
 * Семантика одного reload'а при гибели чанков (#88 guard роутера, #1038 —
 * расширение глобальным слушателем `vite:preloadError`): первый неуспех —
 * reload за сессионный флаг, успех флаг снимает, повторный неуспех reload
 * не запускает (против цикла перезагрузок). Перезагрузка — точка подмены
 * (jsdom: `window.location` LegacyUnforgeable, spyOn невозможен).
 */
describe('chunk-reload: один reload на сессию', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('первая ошибка — reload запущен; повторная — нет, флаг снят', () => {
    const reload = vi.fn();

    expect(reloadOnceOnChunkError(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('nodus-chunk-reload')).toBe('1');

    expect(reloadOnceOnChunkError(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('nodus-chunk-reload')).toBeNull();
  });

  it('успешная загрузка снимает флаг — следующий неуспех снова reload', () => {
    const reload = vi.fn();

    reloadOnceOnChunkError(reload);
    markChunkLoaded();
    expect(sessionStorage.getItem('nodus-chunk-reload')).toBeNull();

    expect(reloadOnceOnChunkError(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('слушатель vite:preloadError (#1038)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('первое событие: preventDefault + один reload; второе — без reload', () => {
    const reload = vi.fn();
    initPreloadErrorReload(reload);

    const first = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    const second = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
