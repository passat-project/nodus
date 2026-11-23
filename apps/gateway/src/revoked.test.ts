import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { createTokenRevokedChecker } from './revoked.js';

/** Стоп-лист access-токенов gateway (#101): тот же ключ, что пишет API. */
describe('createTokenRevokedChecker', () => {
  const checker = (raw: string | null, reject?: Error) => {
    const get = vi.fn(async () => {
      if (reject) throw reject;
      return raw;
    });
    return { get, check: createTokenRevokedChecker({ get } as unknown as Redis) };
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

  it('Redis недоступен — fail-open, хендшейк не валится', async () => {
    const { check } = checker(null, new Error('ECONNREFUSED'));
    await expect(check('user-1', 1000)).resolves.toBe(false);
  });
});
