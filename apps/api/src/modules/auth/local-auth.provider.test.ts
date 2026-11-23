import { describe, expect, it, vi } from 'vitest';

import { LocalAuthProvider } from './local-auth.provider.js';

const CREDENTIALS = { id: 'u1', passwordHash: 'hash', status: 'active' as const };
const IDENTITY = { id: 'u1', email: 'u1@nodus.by', displayName: 'Сотрудник', permissions: [] };

function makeProvider(
  identityStatus: 'active' | 'deactivated' | 'invited',
  credentials: Record<string, unknown> | null = CREDENTIALS,
) {
  const repo = {
    findCredentialsByEmail: vi.fn(async () => credentials),
    updatePassword: vi.fn(),
  };
  // Права приходят из порта ролей через `IdentityLoader` (#379, ADR-0034).
  const identityLoader = {
    load: vi.fn(async () => ({ ...IDENTITY, status: identityStatus })),
  };
  const passwords = {
    verify: vi.fn(async () => true),
    needsRehash: vi.fn(() => false),
    hash: vi.fn(),
  };
  return {
    provider: new LocalAuthProvider(repo as never, identityLoader as never, passwords as never),
    passwords,
  };
}

/** Деактивация, закоммиченная во время argon2, не выпускает токен (#333). */
describe('LocalAuthProvider', () => {
  it('активен и до, и после проверки пароля — identity', async () => {
    await expect(
      makeProvider('active').provider.verifyCredentials('u1@nodus.by', 'p'),
    ).resolves.toMatchObject({ id: 'u1' });
  });

  it('деактивирован во время проверки пароля — null', async () => {
    await expect(
      makeProvider('deactivated').provider.verifyCredentials('u1@nodus.by', 'p'),
    ).resolves.toBeNull();
  });

  it('приглашённый без пароля: verify против dummy-хэша, входа нет (#101)', async () => {
    const { provider, passwords } = makeProvider('invited', {
      ...CREDENTIALS,
      passwordHash: null,
      status: 'invited',
    });
    await expect(provider.verifyCredentials('u1@nodus.by', 'p')).resolves.toBeNull();
    const calls = passwords.verify.mock.calls as unknown as [string, string][];
    expect(calls[0]?.[0]).toMatch(/^\$argon2id\$/);
  });
});
