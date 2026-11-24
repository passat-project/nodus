import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIRECTORY_EVENTS, ErrorCode } from '@nodus/contracts';

import { InvitationAcceptService } from './invitation-accept.service.js';

function tokenEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'token-1',
    userId: 'user-1',
    kind: 'invite',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    revokedAt: null,
    user: {
      id: 'user-1',
      email: 'new.hire@nodus.by',
      displayName: 'Новиков Иван',
      status: 'invited',
      departmentId: 'department-1',
      positionId: 'position-1',
      activatedAt: null,
      invitedAt: new Date(),
      department: { name: 'Проектный отдел' },
      position: { name: 'Инженер' },
    },
    ...overrides,
  };
}

describe('InvitationAcceptService (#101)', () => {
  const invitations = {
    findByHash: vi.fn(),
    markUsed: vi.fn(),
    lockUser: vi.fn(),
    grantEmployeeRoleIfNone: vi.fn(),
  };
  const users = { update: vi.fn() };
  const passwords = { hash: vi.fn(async () => 'argon2-hash') };
  const eventBus = { emit: vi.fn() };
  const throttle = {
    isLocked: vi.fn(async () => false),
    recordFailure: vi.fn(),
    reset: vi.fn(),
  };
  const tx = { run: vi.fn(async (fn: (client: unknown) => unknown) => fn({})) };

  let service: InvitationAcceptService;

  beforeEach(() => {
    vi.clearAllMocks();
    throttle.isLocked.mockResolvedValue(false);
    tx.run.mockImplementation(async (fn: (client: unknown) => unknown) => fn({}));
    service = new InvitationAcceptService(
      invitations as never,
      users as never,
      passwords as never,
      tx as never,
      eventBus as never,
      throttle as never,
    );
  });

  it('неизвестный токен → INVITATION_INVALID + неудача троттлинга', async () => {
    invitations.findByHash.mockResolvedValue(null);
    await expect(
      service.acceptInvitation('bad', {
        email: 'new.hire@nodus.by',
        password: 'Strong!Pass123',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVITATION_INVALID });
    expect(throttle.recordFailure).toHaveBeenCalled();
  });

  it('израсходованный токен → INVITATION_ALREADY_USED', async () => {
    invitations.findByHash.mockResolvedValue(tokenEntry({ usedAt: new Date() }));
    await expect(
      service.acceptInvitation('used', {
        email: 'new.hire@nodus.by',
        password: 'Strong!Pass123',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVITATION_ALREADY_USED });
  });

  it('просроченный токен → INVITATION_INVALID', async () => {
    invitations.findByHash.mockResolvedValue(
      tokenEntry({ expiresAt: new Date(Date.now() - 1_000) }),
    );
    await expect(
      service.acceptInvitation('expired', {
        email: 'new.hire@nodus.by',
        password: 'Strong!Pass123',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVITATION_INVALID });
  });

  it('чужая почта → INVITATION_EMAIL_MISMATCH, токен не расходуется', async () => {
    invitations.findByHash.mockResolvedValue(tokenEntry());
    await expect(
      service.acceptInvitation('token', {
        email: 'other@nodus.by',
        password: 'Strong!Pass123',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVITATION_EMAIL_MISMATCH });
    expect(invitations.markUsed).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('успех: активация, пароль, базовая роль, события accepted + activated', async () => {
    invitations.findByHash.mockResolvedValue(tokenEntry());
    invitations.lockUser.mockResolvedValue({
      id: 'user-1',
      status: 'invited',
      activatedAt: null,
    });
    invitations.markUsed.mockResolvedValue(true);

    const result = await service.acceptInvitation('token', {
      email: 'NEW.HIRE@nodus.by',
      password: 'Strong!Pass123',
    });

    expect(result).toEqual({ id: 'user-1', email: 'new.hire@nodus.by' });
    expect(users.update).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ status: 'active', passwordHash: 'argon2-hash' }),
      expect.anything(),
    );
    expect(invitations.grantEmployeeRoleIfNone).toHaveBeenCalledWith('user-1', expect.anything());
    const types = eventBus.emit.mock.calls.map((call) => call[1]);
    expect(types).toContain(DIRECTORY_EVENTS.INVITATION_ACCEPTED);
    expect(types).toContain(DIRECTORY_EVENTS.USER_ACTIVATED);
    expect(throttle.reset).toHaveBeenCalled();
  });

  it('проигрыш CAS (второй параллельный accept) → INVITATION_ALREADY_USED', async () => {
    invitations.findByHash.mockResolvedValue(tokenEntry());
    invitations.lockUser.mockResolvedValue({
      id: 'user-1',
      status: 'invited',
      activatedAt: null,
    });
    invitations.markUsed.mockResolvedValue(false);

    await expect(
      service.acceptInvitation('token', {
        email: 'new.hire@nodus.by',
        password: 'Strong!Pass123',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVITATION_ALREADY_USED });
    expect(users.update).not.toHaveBeenCalled();
  });

  it('reset-ссылка уволенного не принимается: сначала «Вернуть в работу»', async () => {
    const activatedAt = new Date('2026-01-01T00:00:00Z');
    invitations.findByHash.mockResolvedValue(
      tokenEntry({
        kind: 'reset',
        user: { ...tokenEntry().user, status: 'deactivated', activatedAt },
      }),
    );

    await expect(
      service.acceptPasswordReset('token', {
        email: 'new.hire@nodus.by',
        password: 'Strong!Pass123',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PASSWORD_RESET_INVALID });
    expect(invitations.markUsed).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('reset действующего: только пароль, статус и activatedAt не трогаются', async () => {
    const activatedAt = new Date('2026-01-01T00:00:00Z');
    invitations.findByHash.mockResolvedValue(
      tokenEntry({
        kind: 'reset',
        user: { ...tokenEntry().user, status: 'active', activatedAt },
      }),
    );
    invitations.lockUser.mockResolvedValue({
      id: 'user-1',
      status: 'active',
      activatedAt,
    });
    invitations.markUsed.mockResolvedValue(true);

    await service.acceptPasswordReset('token', {
      email: 'new.hire@nodus.by',
      password: 'Strong!Pass123',
    });

    expect(users.update).toHaveBeenCalledWith(
      'user-1',
      { passwordHash: 'argon2-hash' },
      expect.anything(),
    );
    const types = eventBus.emit.mock.calls.map((call) => call[1]);
    expect(types).toContain(DIRECTORY_EVENTS.USER_PASSWORD_CHANGED);
    expect(types).not.toContain(DIRECTORY_EVENTS.USER_ACTIVATED);
  });
});
