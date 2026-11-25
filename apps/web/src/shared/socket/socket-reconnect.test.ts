import { describe, expect, it, vi } from 'vitest';

import { notifySocketReconnect, registerSocketReconnectListener } from './socket-reconnect.js';

describe('socket-reconnect: реестр подписчиков connect (#1038)', () => {
  it('notify вызывает всех зарегистрированных', () => {
    const first = vi.fn();
    const second = vi.fn();
    registerSocketReconnectListener(first);
    registerSocketReconnectListener(second);

    notifySocketReconnect();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    notifySocketReconnect();
    expect(first).toHaveBeenCalledTimes(2);
  });

  it('отписка: возврат из register снимает слушателя, повторная — безопасна', () => {
    const listener = vi.fn();
    const unregister = registerSocketReconnectListener(listener);
    unregister();
    unregister(); // идемпотентна

    notifySocketReconnect();
    expect(listener).not.toHaveBeenCalled();
  });

  it('исключение одного слушателя не глушит остальных и хендлер сокета', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const boom = vi.fn(() => {
        throw new Error('слушатель сломан');
      });
      const after = vi.fn();
      registerSocketReconnectListener(boom);
      registerSocketReconnectListener(after);

      expect(() => notifySocketReconnect()).not.toThrow();
      expect(boom).toHaveBeenCalledTimes(1);
      expect(after).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
