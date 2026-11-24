import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { createTokenRevokedChecker } from './revoked.js';

/** Стоп-лист access-токенов gateway (#101): тот же ключ, что пишет API. */
describe('createTokenRevokedChecker', () => {
  const checker = (raw: string | null, options: { reject?: Error; hang?: boolean } = {}) => {
    const get = vi.fn(async () => {
      if (options.reject) throw options.reject;
      if (options.hang) return new Promise<string | null>(() => undefined);
      return raw;
    });
    return {
      get,
      check: createTokenRevokedChecker({ status: 'ready', get } as unknown as Redis),
    };
  };

  it('ключа нет — токен жив', async () => {
    const { get, check } = checker(null);
    await expect(check('USER-1', 1000)).resolves.toBe(false);
    expect(get).toHaveBeenCalledWith('nodus:auth:revoked-before:user-1');
  });

  it('iat не позже маркера — отозван; позже — жив', async () => {
    const { check } = checker('1005');
    await expect(check('user-1', 1005)).resolves.toBe(true);
    await expect(check('user-1', 1006)).resolves.toBe(false);
  });

  it('токен без iat при живом маркере — отозван', async () => {
    const { check } = checker('1005');
    await expect(check('user-1', undefined)).resolves.toBe(true);
  });

  it('Redis не ready — fail-open без команды', async () => {
    const get = vi.fn();
    const check = createTokenRevokedChecker({ status: 'reconnecting', get } as unknown as Redis);
    await expect(check('user-1', 1000)).resolves.toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('Redis ошибся или завис — fail-open за ≤300 мс, хендшейк не валится', async () => {
    await expect(checker(null, { reject: new Error('ECONNREFUSED') }).check('u1', 1)).resolves.toBe(
      false,
    );
    const started = Date.now();
    await expect(checker(null, { hang: true }).check('u1', 1)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
