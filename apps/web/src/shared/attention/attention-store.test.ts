// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attentionFlags,
  getAttention,
  isPresenceActive,
  isUserActive,
  isWindowAttentive,
  PRESENCE_ACTIVE_WINDOW_MS,
  resetAttentionForTests,
  setShellFocused,
  setShellVisible,
  startAttentionTracking,
  subscribeAttention,
  USER_ACTIVE_WINDOW_MS,
} from './attention-store.js';

/**
 * Модель внимания (#770, ADR-0038): «прочитано» ставит только активный
 * пользователь (окно на виду + ввод ≤ 30 с); «отошёл» — видимость + ввод
 * ≤ 5 мин. Проверяются переходы, пороги и события ввода без DOM-шума.
 */

beforeEach(() => {
  resetAttentionForTests();
});

afterEach(() => {
  resetAttentionForTests();
  vi.useRealTimers();
});

describe('windowAttentive (окно на виду)', () => {
  it('видимая вкладка + фокус окна и оболочки — внимательно', () => {
    expect(isWindowAttentive()).toBe(true);
  });

  it('потеря фокуса окна — не внимательно, даже со свежим вводом', () => {
    resetAttentionForTests({ focused: false, lastInputAt: Date.now() });
    expect(isWindowAttentive()).toBe(false);
    expect(isUserActive()).toBe(false);
  });

  it('скрытая вкладка — не внимательно', () => {
    resetAttentionForTests({ visible: false });
    expect(isWindowAttentive()).toBe(false);
  });

  it('оболочка: трей (shellVisible=false) и свёрнутость/чужой фокус (shellFocused=false)', () => {
    setShellVisible(false);
    expect(isWindowAttentive()).toBe(false);
    setShellVisible(true);
    expect(isWindowAttentive()).toBe(true);
    setShellFocused(false);
    expect(isWindowAttentive()).toBe(false);
    setShellFocused(true);
    expect(isWindowAttentive()).toBe(true);
  });
});

describe('userActive (право ставить «прочитано»)', () => {
  it('ввод старше 30 с — не активно; граница окна включительна', () => {
    const now = 1_000_000;
    resetAttentionForTests({ lastInputAt: now - USER_ACTIVE_WINDOW_MS });
    expect(isUserActive(now)).toBe(true);
    resetAttentionForTests({ lastInputAt: now - USER_ACTIVE_WINDOW_MS - 1 });
    expect(isUserActive(now)).toBe(false);
  });

  it('без ввода вовсе — не активно (lastInputAt=0)', () => {
    resetAttentionForTests({ lastInputAt: 0 });
    expect(isUserActive()).toBe(false);
  });

  it('активность истекает по таймеру и подписчик получает переход', () => {
    vi.useFakeTimers();
    resetAttentionForTests({ lastInputAt: Date.now() });
    const seen: boolean[] = [];
    subscribeAttention(() => seen.push(isUserActive()));
    expect(isUserActive()).toBe(true);
    vi.advanceTimersByTime(USER_ACTIVE_WINDOW_MS + 10);
    expect(isUserActive()).toBe(false);
    expect(seen).toEqual([false]); // один переход, без шума на каждый ввод
  });

  it('подписка не дёргается на каждый ввод, пока флаг не сменился', () => {
    const fn = vi.fn();
    subscribeAttention(fn);
    startAttentionTracking();
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('keydown'));
    expect(isUserActive()).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('ввод и возврат фокуса', () => {
  it('клик/клавиша/колесо/касание и движение мыши (троттл 1 с) обновляют lastInputAt', () => {
    vi.useFakeTimers();
    resetAttentionForTests({ lastInputAt: 0 });
    startAttentionTracking();
    const t0 = Date.now();
    window.dispatchEvent(new Event('pointerdown'));
    expect(getAttention().lastInputAt).toBe(t0);

    vi.advanceTimersByTime(500);
    const t1 = Date.now();
    window.dispatchEvent(new Event('pointermove'));
    expect(getAttention().lastInputAt).toBe(t1);
    // Второе движение в том же окне троттла — не активность.
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event('pointermove'));
    expect(getAttention().lastInputAt).toBe(t1);
    // Через секунду от первого движения — снова активность.
    vi.advanceTimersByTime(1_200);
    window.dispatchEvent(new Event('pointermove'));
    expect(getAttention().lastInputAt).toBe(t1 + 1_400);

    vi.advanceTimersByTime(10);
    const t2 = Date.now();
    window.dispatchEvent(new Event('wheel'));
    window.dispatchEvent(new Event('keydown'));
    expect(getAttention().lastInputAt).toBe(t2);
    window.dispatchEvent(new Event('touchstart'));
    expect(getAttention().lastInputAt).toBe(t2);
  });

  it('видимость вкладки: hidden — не внимательно, visible — возврат без «ввода»', () => {
    startAttentionTracking();
    const hiddenSpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(isWindowAttentive()).toBe(false);
    hiddenSpy.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(isWindowAttentive()).toBe(true);
  });

  it('возврат фокуса окна считается активностью (дочитывание при возврате)', () => {
    resetAttentionForTests({ focused: false, lastInputAt: 0 });
    startAttentionTracking();
    expect(isUserActive()).toBe(false);
    window.dispatchEvent(new Event('focus'));
    expect(isWindowAttentive()).toBe(true);
    expect(isUserActive()).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(getAttention().focused).toBe(false);
  });

  it('возврат фокуса/видимости оболочки тоже активность, уход — нет (#770)', () => {
    // WebView2 может сохранять document.hasFocus: shell-focus — единственный
    // достоверный сигнал возврата в оболочке.
    resetAttentionForTests({ lastInputAt: 0 });
    expect(isUserActive()).toBe(false);
    setShellFocused(false);
    expect(isUserActive()).toBe(false); // свёрнули — активности не появилось
    setShellFocused(true);
    expect(isUserActive()).toBe(true); // вернулись и смотрим — дочитываем

    resetAttentionForTests({ lastInputAt: 0 });
    setShellVisible(false);
    expect(isUserActive()).toBe(false);
    setShellVisible(true);
    expect(isUserActive()).toBe(true); // вернулись из трея
  });

  it('повторный start не плодит слушателей', () => {
    startAttentionTracking();
    startAttentionTracking();
    resetAttentionForTests({ lastInputAt: 0 });
    startAttentionTracking();
    window.dispatchEvent(new Event('pointerdown'));
    expect(getAttention().lastInputAt).toBeGreaterThan(0);
  });
});

describe('presenceActive (статус присутствия, #772)', () => {
  it('видимо + ввод за 5 мин; фокус не требуется', () => {
    const now = 1_000_000;
    resetAttentionForTests({ focused: false, lastInputAt: now - PRESENCE_ACTIVE_WINDOW_MS });
    expect(isPresenceActive(now)).toBe(true);
    expect(isWindowAttentive(now)).toBe(false);
    resetAttentionForTests({ lastInputAt: now - PRESENCE_ACTIVE_WINDOW_MS - 1 });
    expect(isPresenceActive(now)).toBe(false);
  });

  it('скрытая вкладка/трей — не присутствует', () => {
    resetAttentionForTests({ visible: false });
    expect(isPresenceActive()).toBe(false);
    resetAttentionForTests({ lastInputAt: Date.now() });
    setShellVisible(false);
    expect(isPresenceActive()).toBe(false);
  });

  it('attentionFlags отдаёт все три уровня', () => {
    const flags = attentionFlags();
    expect(flags).toEqual({ windowAttentive: true, userActive: true, presenceActive: true });
  });
});
