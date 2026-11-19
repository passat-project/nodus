import { describe, expect, it, vi } from 'vitest';

import { OfficeSessionsStore } from './office-sessions.store.js';

/** Реестр офисных сессий (#356): ключи документа под TTL для drop уволенного. */

function make(status = 'ready') {
  const exec = vi.fn(async () => []);
  const pipeline = {
    sadd: vi.fn(() => pipeline),
    expire: vi.fn(() => pipeline),
    exec,
  };
  const redis = {
    status,
    pipeline: vi.fn(() => pipeline),
    smembers: vi.fn(async (key: string) =>
      key.includes('nodus:office:documents:') ? ['user-1'] : ['file-1.v1'],
    ),
    del: vi.fn(async () => 1),
  };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const store = new OfficeSessionsStore(redis as never, logger as never);
  return { store, redis, pipeline, logger };
}

/** Мини-Redis с настоящими set-ами: проверяем итоговое состояние реестра. */
function makeMemory() {
  const sets = new Map<string, Set<string>>();
  const redis = {
    status: 'ready',
    pipeline: () => {
      const ops: (() => void)[] = [];
      const pipeline = {
        sadd: (key: string, member: string) => {
          ops.push(() => {
            const set = sets.get(key) ?? new Set<string>();
            set.add(member);
            sets.set(key, set);
          });
          return pipeline;
        },
        expire: () => pipeline,
        exec: async () => {
          for (const op of ops) op();
          return [];
        },
      };
      return pipeline;
    },
    smembers: async (key: string) => [...(sets.get(key) ?? [])],
    del: async (key: string) => (sets.delete(key) ? 1 : 0),
  };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const store = new OfficeSessionsStore(redis as never, logger as never);
  return { store, sets };
}

describe('OfficeSessionsStore (#356)', () => {
  it('register пишет ключ в set пользователя и пользователя в set документа', async () => {
    const { store, pipeline } = make();
    await store.register('user-1', 'file-1.v1');

    expect(pipeline.sadd).toHaveBeenCalledWith('nodus:office:sessions:user-1', 'file-1.v1');
    expect(pipeline.sadd).toHaveBeenCalledWith('nodus:office:documents:file-1.v1', 'user-1');
    expect(pipeline.expire).toHaveBeenCalledWith('nodus:office:sessions:user-1', 604_800);
    expect(pipeline.expire).toHaveBeenCalledWith('nodus:office:documents:file-1.v1', 604_800);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('keysOf и editorsOf читают обе стороны реестра', async () => {
    const { store, redis } = make();
    await expect(store.keysOf('user-1')).resolves.toEqual(['file-1.v1']);
    expect(redis.smembers).toHaveBeenCalledWith('nodus:office:sessions:user-1');

    await expect(store.editorsOf('file-1.v1')).resolves.toEqual(['user-1']);
    expect(redis.smembers).toHaveBeenCalledWith('nodus:office:documents:file-1.v1');
  });

  it('clear чистит ключи пользователя, но НЕ членство в документе (#356)', async () => {
    const { store } = makeMemory();
    await store.register('user-1', 'file-1.v1');

    await store.clear('user-1');

    // Пользователь больше не в своём set, но документ помнит редактора:
    // вторая линия колбэка должна видеть уволенного даже после сбоя drop.
    await expect(store.keysOf('user-1')).resolves.toEqual([]);
    await expect(store.editorsOf('file-1.v1')).resolves.toEqual(['user-1']);
  });

  it('Redis недоступен: register не валит открытие редактора, пишет warn', async () => {
    const { store, logger } = make('connecting');
    await expect(store.register('user-1', 'file-1.v1')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
