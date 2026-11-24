import { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';

const { RevokedUsersStore } = await import('./revoked-users.store.js');

/** Запасная проверка статуса при недоступном Redis (AUD-006). */
function repositoryWith(status: 'active' | 'deactivated') {
  return { findProfileById: vi.fn(async () => ({ status })) };
}

function makeStore(redis: Record<string, unknown>, repository = repositoryWith('active')) {
  const logger = { setContext: vi.fn(), error: vi.fn() };
  return {
    store: new RevokedUsersStore(
      { status: 'ready', ...redis } as never,
      logger as never,
      repository as never,
    ),
    logger,
    repository,
  };
}

/** Стоп-лист уволенных (#333): токен, выданный до деактивации, отвергается. */
describe('RevokedUsersStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('revoke: момент + запас 5 с, только вперёд (скрипт max), TTL access + 60 с', async () => {
    const evalFn = vi.fn(async () => 1);
    const { store } = makeStore({ eval: evalFn });
    await store.revoke('u1', new Date('2026-10-19T10:00:00.900Z'));
    const [script, keys, key, seconds, ttl] = evalFn.mock.calls[0] as unknown as [
      string,
      number,
      string,
      string,
      string,
    ];
    expect(script).toContain('> cur');
    expect(keys).toBe(1);
    expect(key).toBe('nodus:auth:revoked-before:u1');
    expect(Number(seconds)).toBe(Date.UTC(2026, 9, 19, 10) / 1000 + 5);
    expect(Number(ttl)).toBeGreaterThan(60);

    // UUID верхнего регистра пишется в канонический ключ (#101).
    await store.revoke('UPPER-1');
    const upperKey = (
      evalFn.mock.calls[1] as unknown as [string, number, string, string, string]
    )[2];
    expect(upperKey).toBe('nodus:auth:revoked-before:upper-1');
  });

  it('revoke при неготовом Redis — ошибка (диспетчер повторит), не зависание', async () => {
    const { store } = makeStore({ status: 'reconnecting', eval: vi.fn() });
    await expect(store.revoke('u1')).rejects.toThrow(/не готов/);
  });

  it('токен выдан до/в момент — отозван; после (повторная активация) — нет', async () => {
    const { store } = makeStore({ get: vi.fn(async () => '1000') });
    expect(await store.isRevoked('u1', 999)).toBe(true);
    expect(await store.isRevoked('u1', 1000)).toBe(true);
    expect(await store.isRevoked('u1', 1001)).toBe(false);
    expect(await store.isRevoked('u1', undefined)).toBe(true);
  });

  it('записи нет — не отозван', async () => {
    const { store } = makeStore({ get: vi.fn(async () => null) });
    expect(await store.isRevoked('u1', 1)).toBe(false);
  });

  it('Redis не готов — запасная проверка: деактивированный отозван', async () => {
    const repository = repositoryWith('deactivated');
    const { store } = makeStore({ status: 'reconnecting', get: vi.fn() }, repository);

    expect(await store.isRevoked('u1', 1)).toBe(true);
    expect(repository.findProfileById).toHaveBeenCalledWith('u1');
  });

  it('Redis не готов — активный сотрудник проходит', async () => {
    const repository = repositoryWith('active');
    const { store } = makeStore({ status: 'reconnecting', get: vi.fn() }, repository);

    expect(await store.isRevoked('u1', 1)).toBe(false);
    expect(repository.findProfileById).toHaveBeenCalledWith('u1');
  });

  it('Redis и БД недоступны — fail-open: портал не встаёт', async () => {
    const repository = { findProfileById: vi.fn(async () => Promise.reject(new Error('pg down'))) };
    const { store } = makeStore({ status: 'reconnecting', get: vi.fn() }, repository);

    expect(await store.isRevoked('u1', 1)).toBe(false);
  });

  it('Redis завис (команда в очереди без ответа) — запасная проверка по таймауту, error один раз', async () => {
    const { store, logger } = makeStore({
      get: vi.fn(() => new Promise(() => undefined)),
    });
    const started = Date.now();
    expect(await store.isRevoked('u1', 1)).toBe(false);
    expect(await store.isRevoked('u1', 1)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('лог уровня error — не чаще раза в минуту', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
    const { store, logger } = makeStore({ status: 'reconnecting', get: vi.fn() });

    await store.isRevoked('u1', 1);
    await store.isRevoked('u1', 1);
    expect(logger.error).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-16T10:01:01.000Z'));
    await store.isRevoked('u1', 1);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('настоящий ioredis к закрытому порту (настройки общего клиента) — guard не висит', async () => {
    const redis = new Redis('redis://127.0.0.1:1', {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: () => 1_000,
    });
    try {
      const logger = { setContext: vi.fn(), error: vi.fn() };
      const store = new RevokedUsersStore(
        redis as never,
        logger as never,
        repositoryWith('active') as never,
      );
      const started = Date.now();
      expect(await store.isRevoked('u1', 1)).toBe(false);
      expect(Date.now() - started).toBeLessThan(1_000);
      await expect(store.revoke('u1')).rejects.toThrow();
    } finally {
      redis.disconnect();
    }
  });
});
