import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { registerUnhandledRejectionHandler } from './unhandled-rejection.ts';

describe('registerUnhandledRejectionHandler (AUD-018)', () => {
  it('необработанный отказ пишется в error с причиной', () => {
    const emitter = new EventEmitter();
    const logError = vi.fn();
    registerUnhandledRejectionHandler(logError, emitter);
    const reason = new Error('Redis недоступен');
    emitter.emit('unhandledRejection', reason);
    expect(logError).toHaveBeenCalledWith('Необработанный отказ в фоновой задаче', reason);
  });

  it('uncaughtException не глушится — слушателя нет', () => {
    const emitter = new EventEmitter();
    registerUnhandledRejectionHandler(vi.fn(), emitter);
    expect(emitter.listenerCount('uncaughtException')).toBe(0);
  });
});
