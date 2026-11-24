import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { AuthService } from './auth.service.js';

const IDENTITY = {
  id: 'user-1',
  email: 'a@b.by',
  displayName: 'Иванов Иван',
  status: 'active' as const,
  permissions: [],
};

/** Смена пароля: проверка старого + отзыв остальных сессий (I5: вынесено из
 *  общего auth.service.test.ts). */
describe('AuthService: changePassword', () => {
  const authRepository = {
    findProfileById: vi.fn(),
    findCredentialsByEmail: vi.fn(),
    updatePassword: vi.fn(),
    revokeAllSessions: vi.fn(),
  };
  const passwordService = { verify: vi.fn(), hash: vi.fn() };

  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService(
      {} as never,
      authRepository as never,
      {} as never,
      passwordService as never,
      { config: { accessTtlSeconds: 900, refreshTtlDays: 30 } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('неверный старый пароль → AUTH_INVALID_CREDENTIALS', async () => {
    authRepository.findProfileById.mockResolvedValue(IDENTITY);
    authRepository.findCredentialsByEmail.mockResolvedValue({ ...IDENTITY, passwordHash: 'hash' });
    passwordService.verify.mockResolvedValue(false);

    await expect(
      service.changePassword('user-1', 'bad', 'New!234567890', 's1'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
  });

  it('успех → перехэш + отзыв всех сессий кроме текущей', async () => {
    authRepository.findProfileById.mockResolvedValue(IDENTITY);
    authRepository.findCredentialsByEmail.mockResolvedValue({ ...IDENTITY, passwordHash: 'hash' });
    passwordService.verify.mockResolvedValue(true);
    passwordService.hash.mockResolvedValue('new-hash');

    await service.changePassword('user-1', 'old', 'New!234567890', 'session-1');

    expect(authRepository.updatePassword).toHaveBeenCalledWith('user-1', 'new-hash');
    expect(authRepository.revokeAllSessions).toHaveBeenCalledWith('user-1', 'session-1');
  });
});
