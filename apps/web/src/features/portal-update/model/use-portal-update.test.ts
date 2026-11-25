// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notifySocketReconnect } from '../../../shared/socket/socket-reconnect.js';
import { usePortalUpdateStore } from './portal-update-store.js';
import { CHECK_INTERVAL_MS, usePortalUpdate } from './use-portal-update.js';

/** Триггеры сверки версии (#1038): фокус/видимость/интервал/реконнект. В MODE='test'
 * хук инертен — прогоняем под заглушённым MODE, иначе тестировать нечего. */
describe('usePortalUpdate', () => {
  const checkSpy = vi.spyOn(usePortalUpdateStore.getState(), 'check');

  beforeEach(() => {
    vi.stubEnv('MODE', 'development');
    vi.useFakeTimers();
    checkSpy.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    cleanup();
  });

  it('инертен в MODE=test — триггеры не вешаются', () => {
    vi.stubEnv('MODE', 'test');
    const add = vi.spyOn(window, 'addEventListener');
    renderHook(() => usePortalUpdate());
    expect(add).not.toHaveBeenCalledWith('focus', expect.any(Function));
    add.mockRestore();
  });

  it('фокус окна запускает сверку', () => {
    renderHook(() => usePortalUpdate());
    expect(checkSpy).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  it('видимая вкладка запускает сверку, скрытая — нет', () => {
    renderHook(() => usePortalUpdate());
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  it('интервал 45 минут запускает сверку', () => {
    renderHook(() => usePortalUpdate());
    act(() => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    expect(checkSpy).toHaveBeenCalled();
  });

  it('реконнект сокета запускает сверку', () => {
    renderHook(() => usePortalUpdate());
    act(() => {
      notifySocketReconnect();
    });
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  it('отмонтирован — слушатели и таймер сняты', () => {
    const { unmount } = renderHook(() => usePortalUpdate());
    const clear = vi.spyOn(window, 'clearInterval');
    unmount();
    expect(clear).toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(checkSpy).not.toHaveBeenCalled();
  });
});
