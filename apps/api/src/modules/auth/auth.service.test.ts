import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { AuthService } from './auth.service.js';

const IDENTITY = {
  id: 'user-1',
  email: 'a@b.by',
  displayName: 'Иванов Иван',
  status: 'active' as const,
  permissions: ['directory.read'],
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    refreshTokenHash: 'a'.repeat(64),
    previousRefreshTokenHash: null,
    userAgent: 'agent',
    ip: '127.0.0.1',
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  const authProvider = { verifyCredentials: vi.fn() };
  const authRepository = {
    findCredentialsByEmail: vi.fn(),
    findStatusByEmail: vi.fn(),
    findProfileById: vi.fn(),
    updatePassword: vi.fn(),
    createSession: vi.fn(),
    findSessionById: vi.fn(),
    rotateSessionIfCurrent: vi.fn().mockResolvedValue(true),
    revokeSession: vi.fn(),
    revokeAllSessions: vi.fn(),
    listActiveSessions: vi.fn(),
  };
  // Права — из порта ролей (#379, ADR-0034): профиль отдельно, права отдельно.
  const identityLoader = { load: vi.fn() };
  const passwordService = { verify: vi.fn(), hash: vi.fn(), needsRehash: vi.fn() };
  const tokenService = {
    config: { accessTtlSeconds: 900, refreshTtlDays: 30 },
    signAccessToken: vi.fn().mockResolvedValue('access-jwt'),
    generateRefreshToken: vi.fn().mockReturnValue({ token: 'raw-token', hash: 'b'.repeat(64) }),
    hashRefreshToken: vi.fn().mockReturnValue('a'.repeat(64)),
    hashesEqual: vi.fn((a: string, b: string) => a === b),
    parseRefreshCookie: vi.fn((raw?: string) =>
      raw ? { sessionId: 'session-1', token: 'raw-token' } : null,
    ),
  };
  const audit = { append: vi.fn() };
  const loginThrottle = {
    isLocked: vi.fn().mockResolvedValue(false),
    recordFailure: vi.fn(),
    reset: vi.fn(),
  };
  const featureFlags = { enabledModules: vi.fn().mockResolvedValue(['tasks', 'projects']) };

  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks не сбрасывает реализации — возвращаем дефолты явно.
    tokenService.hashesEqual.mockImplementation((a: string, b: string) => a === b);
    tokenService.parseRefreshCookie.mockImplementation((raw?: string) =>
      raw ? { sessionId: 'session-1', token: 'raw-token' } : null,
    );
    loginThrottle.isLocked.mockResolvedValue(false);
    authRepository.rotateSessionIfCurrent.mockResolvedValue(true);
    authRepository.findStatusByEmail.mockResolvedValue(null);
    service = new AuthService(
      authProvider as never,
      authRepository as never,
      identityLoader as never,
      passwordService as never,
      tokenService as never,
      audit as never,
      loginThrottle as never,
      featureFlags as never,
    );
  });

  describe('getMe', () => {
    it('отдаёт свежие права и включённые модули (Р14 #52)', async () => {
      identityLoader.load.mockResolvedValue(IDENTITY);

      await expect(service.getMe('user-1')).resolves.toEqual({
        id: 'user-1',
        email: 'a@b.by',
        displayName: 'Иванов Иван',
        permissions: ['directory.read'],
        modules: ['tasks', 'projects'],
      });
    });
  });

  describe('login', () => {
    it('неверные креды → AUTH_INVALID_CREDENTIALS + аудит + счётчик неудач', async () => {
      authProvider.verifyCredentials.mockResolvedValue(null);

      await expect(service.login('a@b.by', 'bad', '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });
      expect(loginThrottle.recordFailure).toHaveBeenCalledWith('a@b.by');
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login_failed', details: { email: 'a@b.by' } }),
      );
      expect(authRepository.createSession).not.toHaveBeenCalled();
    });

    it('заблокированная учётка → 401 без обращения к провайдеру + аудит', async () => {
      loginThrottle.isLocked.mockResolvedValue(true);

      await expect(service.login('a@b.by', 'any', '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });
      expect(authProvider.verifyCredentials).not.toHaveBeenCalled();
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login_throttled' }),
      );
    });

    it('успех → сессия + access-токен + сброс счётчика', async () => {
      authProvider.verifyCredentials.mockResolvedValue(IDENTITY);
      authRepository.createSession.mockResolvedValue(makeSession());

      const result = await service.login('a@b.by', 'ok', '1.1.1.1', 'ua');

      expect(result.accessToken).toBe('access-jwt');
      expect(result.refreshToken).toBe('raw-token');
      expect(result.expiresIn).toBe(900);
      expect(loginThrottle.reset).toHaveBeenCalledWith('a@b.by');
      expect(authRepository.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', refreshTokenHash: 'b'.repeat(64) }),
      );
    });
  });

  describe('refresh (ротация)', () => {
    it('нет cookie → AUTH_SESSION_INVALID', async () => {
      await expect(service.refresh(undefined, '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_INVALID,
      });
    });

    it('отозванная сессия → AUTH_SESSION_INVALID', async () => {
      authRepository.findSessionById.mockResolvedValue(makeSession({ revokedAt: new Date() }));

      await expect(service.refresh('cookie', '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_INVALID,
      });
    });

    it('reuse сменённого токена ПОСЛЕ leeway → отзыв сессии + аудит + 401', async () => {
      const session = makeSession({
        previousRefreshTokenHash: 'a'.repeat(64),
        updatedAt: new Date(Date.now() - 60_000), // ротация была минуту назад
      });
      authRepository.findSessionById.mockResolvedValue(session);

      await expect(service.refresh('cookie', '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_INVALID,
      });
      expect(authRepository.revokeSession).toHaveBeenCalledWith('session-1');
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.session_reuse_detected' }),
      );
    });

    it('предыдущий токен В ПРЕДЕЛАХ leeway (гонка мультитаб) → штатная ротация', async () => {
      const session = makeSession({
        previousRefreshTokenHash: 'a'.repeat(64),
        updatedAt: new Date(), // ротация только что
      });
      authRepository.findSessionById.mockResolvedValue(session);
      identityLoader.load.mockResolvedValue(IDENTITY);

      const result = await service.refresh('cookie', '1.1.1.1', 'ua');

      expect(result.accessToken).toBe('access-jwt');
      expect(authRepository.rotateSessionIfCurrent).toHaveBeenCalled();
      expect(authRepository.revokeSession).not.toHaveBeenCalled();
    });

    it('чужой токен на валидной сессии → 401 без отзыва', async () => {
      authRepository.findSessionById.mockResolvedValue(makeSession());
      tokenService.hashesEqual.mockReturnValue(false);

      await expect(service.refresh('cookie', '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_INVALID,
      });
      expect(authRepository.revokeSession).not.toHaveBeenCalled();
    });

    it('валидный токен → ротация и новая пара', async () => {
      authRepository.findSessionById.mockResolvedValue(makeSession());
      identityLoader.load.mockResolvedValue(IDENTITY);

      const result = await service.refresh('cookie', '1.1.1.1', 'ua');

      expect(result.accessToken).toBe('access-jwt');
      expect(authRepository.rotateSessionIfCurrent).toHaveBeenCalledWith(
        'session-1',
        'a'.repeat(64), // CAS-база: предъявленный текущий
        'b'.repeat(64),
        expect.any(Date),
      );
    });

    it('гонка двух вкладок: проигрыш CAS → перечитали, предъявленный стал предыдущим в leeway → ротация поверх выигравшей', async () => {
      const winnerHash = 'c'.repeat(64);
      authRepository.findSessionById
        .mockResolvedValueOnce(makeSession()) // до ротации соседней вкладки
        .mockResolvedValueOnce(
          makeSession({
            refreshTokenHash: winnerHash,
            previousRefreshTokenHash: 'a'.repeat(64),
            updatedAt: new Date(), // соседняя вкладка ротировала только что
          }),
        );
      identityLoader.load.mockResolvedValue(IDENTITY);
      authRepository.rotateSessionIfCurrent
        .mockResolvedValueOnce(false) // соседняя вкладка успела раньше
        .mockResolvedValueOnce(true);

      const result = await service.refresh('cookie', '1.1.1.1', 'ua');

      expect(result.refreshToken).toBe('raw-token');
      expect(authRepository.rotateSessionIfCurrent).toHaveBeenCalledTimes(2);
      expect(authRepository.rotateSessionIfCurrent).toHaveBeenLastCalledWith(
        'session-1',
        winnerHash,
        'b'.repeat(64),
        expect.any(Date),
      );
      expect(authRepository.revokeSession).not.toHaveBeenCalled();
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('проигрыш CAS, а предъявленный уже не текущий и не предыдущий → 401 без отзыва', async () => {
      authRepository.findSessionById.mockResolvedValueOnce(makeSession()).mockResolvedValueOnce(
        makeSession({
          refreshTokenHash: 'd'.repeat(64),
          previousRefreshTokenHash: 'c'.repeat(64),
        }),
      );
      identityLoader.load.mockResolvedValue(IDENTITY);
      authRepository.rotateSessionIfCurrent.mockResolvedValueOnce(false);

      await expect(service.refresh('cookie', '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_INVALID,
      });
      expect(authRepository.rotateSessionIfCurrent).toHaveBeenCalledTimes(1);
      expect(authRepository.revokeSession).not.toHaveBeenCalled();
    });

    it('деактивация между проигрышем CAS и повтором → 401 и отзыв, токен не выпущен', async () => {
      authRepository.findSessionById.mockResolvedValue(makeSession());
      identityLoader.load
        .mockResolvedValueOnce(IDENTITY)
        .mockResolvedValueOnce({ ...IDENTITY, status: 'inactive' });
      authRepository.rotateSessionIfCurrent.mockResolvedValueOnce(false);

      await expect(service.refresh('cookie', '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_INVALID,
      });
      expect(authRepository.rotateSessionIfCurrent).toHaveBeenCalledTimes(1);
      expect(authRepository.revokeSession).toHaveBeenCalledWith('session-1');
      expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    });

    it('CAS проигран на всех попытках → 401, сессия не отзывается', async () => {
      authRepository.findSessionById.mockResolvedValue(makeSession());
      identityLoader.load.mockResolvedValue(IDENTITY);
      authRepository.rotateSessionIfCurrent.mockResolvedValue(false);

      await expect(service.refresh('cookie', '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_INVALID,
      });
      expect(authRepository.rotateSessionIfCurrent).toHaveBeenCalledTimes(3);
      expect(authRepository.revokeSession).not.toHaveBeenCalled();
    });

    it('деактивированный пользователь → отзыв сессии + 401', async () => {
      authRepository.findSessionById.mockResolvedValue(makeSession());
      identityLoader.load.mockResolvedValue({ ...IDENTITY, status: 'deactivated' });

      await expect(service.refresh('cookie', '1.1.1.1', 'ua')).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_INVALID,
      });
      expect(authRepository.revokeSession).toHaveBeenCalledWith('session-1');
    });
  });

  describe('logout', () => {
    it('идемпотентен: нет cookie / нет сессии / чужой токен — тихо', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      authRepository.findSessionById.mockResolvedValue(null);
      await expect(service.logout('cookie')).resolves.toBeUndefined();
      authRepository.findSessionById.mockResolvedValue(makeSession());
      tokenService.hashesEqual.mockReturnValue(false);
      await expect(service.logout('cookie')).resolves.toBeUndefined();
      expect(authRepository.revokeSession).not.toHaveBeenCalled();
    });

    it('валидный токен → отзыв', async () => {
      authRepository.findSessionById.mockResolvedValue(makeSession());
      await service.logout('cookie');
      expect(authRepository.revokeSession).toHaveBeenCalledWith('session-1');
    });
  });
});
