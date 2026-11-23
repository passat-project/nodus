import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { AuthService } from './auth.service.js';

/** Вход приглашённого до активации (#101, ADR-0054). Вынесен из большого
 *  auth.service.test.ts (лимит I5); сценарий Login целиком. */
describe('AuthService: приглашённый (#101)', () => {
  const authProvider = { verifyCredentials: vi.fn() };
  const authRepository = {
    findStatusByEmail: vi.fn(),
    createSession: vi.fn(),
  };
  const loginThrottle = {
    isLocked: vi.fn(async () => false),
    recordFailure: vi.fn(),
    reset: vi.fn(),
  };
  const audit = { append: vi.fn() };
  const tokenService = { config: { accessTtlSeconds: 900, refreshTtlDays: 30 } };

  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    loginThrottle.isLocked.mockResolvedValue(false);
    service = new AuthService(
      authProvider as never,
      authRepository as never,
      {} as never,
      {} as never,
      tokenService as never,
      audit as never,
      loginThrottle as never,
      {} as never,
    );
  });

  it('вход до активации → AUTH_ACCOUNT_NOT_ACTIVATED, сессия не создаётся', async () => {
    authRepository.findStatusByEmail.mockResolvedValue({ id: 'user-1', status: 'invited' });

    await expect(service.login('a@b.by', 'any', '1.1.1.1', 'ua')).rejects.toMatchObject({
      code: ErrorCode.AUTH_ACCOUNT_NOT_ACTIVATED,
    });
    expect(authProvider.verifyCredentials).not.toHaveBeenCalled();
    expect(authRepository.createSession).not.toHaveBeenCalled();
    expect(loginThrottle.recordFailure).toHaveBeenCalledWith('a@b.by');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login_failed',
        details: { email: 'a@b.by', reason: 'not_activated' },
      }),
    );
  });
});
