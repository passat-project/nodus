// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const debug = vi.hoisted(() => ({ enabled: true }));

vi.mock('../../shared/socket/ws-debug.js', () => ({
  get wsDebugEnabled() {
    return debug.enabled;
  },
  wsDebugLog: vi.fn(),
}));

import { startLayoutJitterLogger } from './layout-jitter-logger.js';

/** #1032: rAF-цикл диагностики живёт только пока смонтирован хост. */
afterEach(() => {
  debug.enabled = true;
  vi.restoreAllMocks();
});

describe('startLayoutJitterLogger (#1032)', () => {
  it('stop отменяет запланированный кадр и прекращает цикл', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(41);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const stop = startLayoutJitterLogger();
    expect(raf).toHaveBeenCalledTimes(1);
    const tick = raf.mock.calls[0]![0]!;

    stop();
    expect(cancel).toHaveBeenCalledWith(41);

    // Даже если кадр уже отдан браузером, тик после stop молчит.
    raf.mockClear();
    tick(0);
    expect(raf).not.toHaveBeenCalled();
  });

  it('тик продолжает цикл, пока логгер не остановлен', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(9);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const stop = startLayoutJitterLogger();
    const tick = raf.mock.calls[0]![0]!;
    tick(0);
    expect(raf).toHaveBeenCalledTimes(2);
    stop();
  });

  it('без ?wsdebug=1 возвращает no-op', () => {
    debug.enabled = false;
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const stop = startLayoutJitterLogger();
    expect(raf).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});
