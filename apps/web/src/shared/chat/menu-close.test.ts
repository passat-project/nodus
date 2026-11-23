// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeMenuThenRun, MENU_CLOSE_ANIMATION_MS } from './menu-close.js';

/** #273: closeFirst-пункт закрывает меню ЯВНО до отложенного действия —
 *  закрытие не зависит от неявного handleSelect Radix (гонка с морфингом
 *  содержимого в анимации закрытия могла оставить меню открытым). */
describe('closeMenuThenRun', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('закрывает меню синхронно, действие — после анимации закрытия', () => {
    vi.useFakeTimers();
    const calls: string[] = [];

    closeMenuThenRun(
      () => calls.push('close'),
      () => calls.push('run'),
    );

    expect(calls).toEqual(['close']);
    vi.advanceTimersByTime(MENU_CLOSE_ANIMATION_MS - 1);
    expect(calls).toEqual(['close']);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['close', 'run']);
  });

  it('повторный вызов не выполняет действие раньше своего таймера', () => {
    vi.useFakeTimers();
    const calls: string[] = [];

    closeMenuThenRun(
      () => calls.push('close-1'),
      () => calls.push('run-1'),
    );
    closeMenuThenRun(
      () => calls.push('close-2'),
      () => calls.push('run-2'),
    );

    expect(calls).toEqual(['close-1', 'close-2']);
    vi.advanceTimersByTime(MENU_CLOSE_ANIMATION_MS);
    expect(calls).toEqual(['close-1', 'close-2', 'run-1', 'run-2']);
  });
});
