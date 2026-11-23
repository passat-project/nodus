import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIRECTORY_EVENTS,
  ErrorCode,
  type AuthUser,
  type CreateInvitationDto,
} from '@nodus/contracts';

import { InvitationsService, INVITE_TTL_MS, RESET_TTL_MS } from './invitations.service.js';

const ACTOR: AuthUser = {
  id: 'admin-1',
  email: 'admin@nodus.by',
  displayName: 'Админ',
  permissions: [],
};

const DTO: CreateInvitationDto = {
  email: 'new.hire@nodus.by',
  lastName: 'Новиков',
  firstName: 'Иван',
  middleName: null,
  positionId: 'position-1',
  departmentId: 'department-1',
};

const RAW_TOKEN = 'raw-token-'.padEnd(64, 'x');

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

describe('InvitationsService (админ, #101)', () => {
  const invitations = {
    createToken: vi.fn(),
    findByHash: vi.fn(),
    revokeActive: vi.fn(),
    markUsed: vi.fn(),
    lockUser: vi.fn(),
    findUserById: vi.fn(),
    deleteUser: vi.fn(),
    grantEmployeeRoleIfNone: vi.fn(),
    lockExpiryCandidates: vi.fn(),
  };
  const users = {
    emailExists: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findCardById: vi.fn(),
  };
  const passwords = {
    hash: vi.fn(async () => 'argon2-hash'),
    generateSecureToken: vi.fn(() => RAW_TOKEN),
  };
  const eventBus = { emit: vi.fn() };
  const references = {
    ensureDepartment: vi.fn(),
    ensurePosition: vi.fn(),
    lockPositions: vi.fn(),
  };
  const managers = { recomputeUsers: vi.fn() };
  const tx = { run: vi.fn(async (fn: (client: unknown) => unknown) => fn({})) };

  let service: InvitationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.run.mockImplementation(async (fn: (client: unknown) => unknown) => fn({}));
    service = new InvitationsService(
      invitations as never,
      users as never,
      passwords as never,
      tx as never,
      eventBus as never,
      references as never,
      managers as never,
    );
  });

  describe('создание', () => {
    it('дубль почты → DIRECTORY_EMAIL_TAKEN', async () => {
      users.emailExists.mockResolvedValue(true);
      await expect(service.createInvitation(DTO, ACTOR)).rejects.toMatchObject({
        code: ErrorCode.DIRECTORY_EMAIL_TAKEN,
      });
      expect(users.create).not.toHaveBeenCalled();
    });

    it('создаёт строку invited без пароля и одноразовую ссылку на 7 дней', async () => {
      users.emailExists.mockResolvedValue(false);
      users.create.mockResolvedValue({ id: 'user-1', email: DTO.email });
      invitations.createToken.mockImplementation(async () => ({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      }));

      const result = await service.createInvitation(DTO, ACTOR);

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new.hire@nodus.by',
          status: 'invited',
          passwordHash: null,
          invitedAt: expect.any(Date),
          activatedAt: null,
          displayName: 'Новиков Иван',
        }),
        expect.anything(),
      );
      expect(references.ensureDepartment).toHaveBeenCalledWith(
        'department-1',
        'management',
        'departmentId',
        expect.anything(),
      );
      expect(managers.recomputeUsers).toHaveBeenCalledWith(['user-1'], expect.anything());
      expect(invitations.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', kind: 'invite', createdBy: 'admin-1' }),
        expect.anything(),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.anything(),
        DIRECTORY_EVENTS.INVITATION_CREATED,
        expect.objectContaining({ userId: 'user-1', email: 'new.hire@nodus.by' }),
        expect.anything(),
      );
      expect(result.path).toBe(`/invite/${RAW_TOKEN}`);
      const expires = new Date(result.expiresAt).getTime();
      expect(expires - Date.now()).toBeGreaterThan(INVITE_TTL_MS - 5_000);
    });
  });

  describe('перевыпуск и отмена', () => {
    it('перевыпуск не-приглашённого → CONFLICT', async () => {
      invitations.lockUser.mockResolvedValue({
        id: 'user-1',
        status: 'active',
        activatedAt: new Date(),
      });
      await expect(service.reissueInvitation('user-1', ACTOR)).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
      });
      expect(invitations.createToken).not.toHaveBeenCalled();
    });

    it('отмена никогда не активированной строки удаляет её и шлёт user.deleted', async () => {
      invitations.lockUser.mockResolvedValue({
        id: 'user-1',
        status: 'invited',
        activatedAt: null,
      });
      invitations.findUserById.mockResolvedValue(tokenEntry().user);

      await service.cancelInvitation('user-1', ACTOR);

      expect(invitations.deleteUser).toHaveBeenCalledWith('user-1', expect.anything());
      const types = eventBus.emit.mock.calls.map((call) => call[1]);
      expect(types).toContain(DIRECTORY_EVENTS.INVITATION_REVOKED);
      expect(types).toContain(DIRECTORY_EVENTS.USER_DELETED);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('отмена бывшего сотрудника возвращает «Уволен» и шлёт user.deactivated', async () => {
      invitations.lockUser.mockResolvedValue({
        id: 'user-1',
        status: 'invited',
        activatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      invitations.findUserById.mockResolvedValue(tokenEntry().user);

      await service.cancelInvitation('user-1', ACTOR);

      expect(users.update).toHaveBeenCalledWith(
        'user-1',
        { status: 'deactivated' },
        expect.anything(),
      );
      const types = eventBus.emit.mock.calls.map((call) => call[1]);
      expect(types).toContain(DIRECTORY_EVENTS.USER_DEACTIVATED);
      expect(invitations.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('сброс пароля', () => {
    it('приглашённому сброс не выпускается → CONFLICT', async () => {
      users.findCardById.mockResolvedValue({ id: 'user-1', status: 'invited' });
      await expect(service.issuePasswordReset('user-1', ACTOR)).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
      });
      expect(invitations.createToken).not.toHaveBeenCalled();
    });

    it('уволенному выпускается reset-ссылка на 24 часа + событие отзыва сессий', async () => {
      users.findCardById.mockResolvedValue({ id: 'user-1', status: 'deactivated' });
      invitations.createToken.mockImplementation(async () => ({
        id: 'token-2',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      }));

      const result = await service.issuePasswordReset('user-1', ACTOR);

      expect(result.path).toMatch(/^\/reset\//);
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.anything(),
        DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
        { userId: 'user-1', byAdminId: 'admin-1' },
        expect.anything(),
      );
      const expires = new Date(result.expiresAt).getTime();
      expect(expires - Date.now()).toBeGreaterThan(RESET_TTL_MS - 5_000);
    });
  });

  describe('автоистечение', () => {
    it('новая строка удаляется, бывший сотрудник возвращается в «Уволен»', async () => {
      invitations.lockExpiryCandidates.mockResolvedValue([
        { id: 'new-user', activatedAt: null },
        { id: 'former', activatedAt: new Date('2026-01-01T00:00:00Z') },
      ]);

      const result = await service.expireInvitations(50);

      expect(result).toEqual([
        { userId: 'new-user', removed: true },
        { userId: 'former', removed: false },
      ]);
      expect(invitations.deleteUser).toHaveBeenCalledWith('new-user', expect.anything());
      expect(users.update).toHaveBeenCalledWith(
        'former',
        { status: 'deactivated' },
        expect.anything(),
      );
      const types = eventBus.emit.mock.calls.map((call) => call[1]);
      expect(types.filter((type) => type === DIRECTORY_EVENTS.INVITATION_EXPIRED)).toHaveLength(2);
      expect(types).toContain(DIRECTORY_EVENTS.USER_DELETED);
      expect(types).toContain(DIRECTORY_EVENTS.USER_DEACTIVATED);
    });
  });
});
