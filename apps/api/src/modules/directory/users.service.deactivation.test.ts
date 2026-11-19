import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser } from '@nodus/contracts';

import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { UsersService } from './users.service.js';

const actor = (permissions: string[] = []): AuthUser => ({
  id: 'admin-1',
  email: 'a@b.by',
  displayName: 'Админ',
  permissions,
});

function cardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'new@nodus.by',
    displayName: 'Новый Сотрудник',
    status: 'active',
    lastName: 'Новый',
    firstName: 'Сотрудник',
    middleName: null,
    managerId: null,
    departmentId: null,
    positionId: null,
    legalDepartmentId: null,
    legalPositionId: null,
    mobilePhone: null,
    city: null,
    officeLocation: null,
    isRemote: false,
    workRate: null,
    gender: null,
    birthDate: null,
    hiredAt: null,
    workdayStart: null,
    avatarUrl: null,
    roles: [] as { role: { id: string; code: string; name: string } }[],
    createdAt: new Date('2026-09-02T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    ...overrides,
  };
}

const withRoles = (roles: { id: string; code: string; name: string }[]) =>
  cardRow({ roles: roles.map((role) => ({ role })) });

/** Деактивация и защита последнего администратора (#490). */
describe('UsersService: деактивация сотрудника', () => {
  const users = {
    findCardById: vi.fn(),
    update: vi.fn(),
  };
  const roles = {
    lockForUpdate: vi.fn(),
    lockByCodeForUpdate: vi.fn(),
    countActiveDirectMembers: vi.fn(),
  };
  const membership = { effectiveRoleIds: vi.fn() };
  const departmentsRepo = { clearHeadAndDeputy: vi.fn(), lockTree: vi.fn() };
  const managers = { recomputeUsers: vi.fn(), recomputeDepartments: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: UsersService;

  beforeEach(() => {
    vi.resetAllMocks();
    membership.effectiveRoleIds.mockResolvedValue([]);
    roles.lockByCodeForUpdate.mockResolvedValue(null);
    departmentsRepo.clearHeadAndDeputy.mockResolvedValue([]);
    managers.recomputeDepartments.mockResolvedValue([]);
    const guard = new RoleAssignmentGuard(roles as never, membership as never);
    const references = new ReferenceGuard(
      users as never,
      { findRef: vi.fn() } as never,
      { findRef: vi.fn() } as never,
    );
    service = new UsersService(
      users as never,
      roles as never,
      { hash: vi.fn() } as never,
      tx as never,
      eventBus as never,
      { fileContentUrl: vi.fn() } as never,
      guard,
      references,
      departmentsRepo as never,
      managers as never,
      { process: vi.fn() } as never,
      { subordinateIds: vi.fn(), managerChainOf: vi.fn() } as never,
    );
  });

  it('себя уволить нельзя → 409 DIRECTORY_SELF_DEACTIVATE без записи', async () => {
    await expect(service.deactivateUser('admin-1', actor())).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_SELF_DEACTIVATE,
    });
    expect(users.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('глава/зам подразделений: ссылки снимаются, событие department.updated, пересчёт руководителей', async () => {
    users.findCardById.mockResolvedValue(cardRow());
    departmentsRepo.clearHeadAndDeputy.mockResolvedValue([
      { id: 'dep-1', head: true, deputy: false },
      { id: 'dep-2', head: false, deputy: true },
    ]);

    await service.deactivateUser('user-1', actor());

    expect(departmentsRepo.clearHeadAndDeputy).toHaveBeenCalledWith('user-1', 'tx-handle');
    expect(departmentsRepo.lockTree).toHaveBeenCalledWith('tx-handle');
    expect(managers.recomputeDepartments).toHaveBeenCalledWith(['dep-1', 'dep-2'], 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.department.updated',
      { departmentId: 'dep-1', changedFields: ['headId'] },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.department.updated',
      { departmentId: 'dep-2', changedFields: ['deputyId'] },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
  });

  it('деактивация → событие directory.user.deactivated', async () => {
    users.findCardById.mockResolvedValue(cardRow());

    await service.deactivateUser('user-1', actor());

    expect(users.update).toHaveBeenCalledWith('user-1', { status: 'deactivated' }, 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.user.deactivated',
      { userId: 'user-1' },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
  });

  it('ссылки главы снимаются ДО записи статуса (порядок замков, #923)', async () => {
    users.findCardById.mockResolvedValue(cardRow());
    departmentsRepo.clearHeadAndDeputy.mockResolvedValue([
      { id: 'dep-1', head: true, deputy: false },
    ]);

    await service.deactivateUser('user-1', actor());

    expect(departmentsRepo.clearHeadAndDeputy.mock.invocationCallOrder[0]!).toBeLessThan(
      users.update.mock.invocationCallOrder[0]!,
    );
  });

  it('идемпотентна: уже деактивирован — без события', async () => {
    users.findCardById.mockResolvedValue(cardRow({ status: 'deactivated' }));

    await service.deactivateUser('user-1', actor());

    expect(users.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('не найден → NOT_FOUND', async () => {
    users.findCardById.mockResolvedValue(null);

    await expect(service.deactivateUser('nope', actor())).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('последний администратор: деактивация → 409 ROLE_LAST_ADMIN, замок строки admin', async () => {
    users.findCardById.mockResolvedValue(
      withRoles([{ id: 'role-admin', code: 'admin', name: 'Администратор' }]),
    );
    roles.lockByCodeForUpdate.mockResolvedValue('role-admin');
    roles.countActiveDirectMembers.mockResolvedValue(0);

    await expect(service.deactivateUser('user-1', actor())).rejects.toMatchObject({
      code: ErrorCode.ROLE_LAST_ADMIN,
    });
    expect(roles.lockByCodeForUpdate).toHaveBeenCalledWith('admin', 'tx-handle');
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('администратор, у роли есть другие активные участники — деактивация разрешена', async () => {
    users.findCardById.mockResolvedValue(
      withRoles([{ id: 'role-admin', code: 'admin', name: 'Администратор' }]),
    );
    roles.lockByCodeForUpdate.mockResolvedValue('role-admin');
    roles.countActiveDirectMembers.mockResolvedValue(3);

    await service.deactivateUser('user-1', actor());

    expect(eventBus.emit).toHaveBeenCalled();
  });

  it('не администратор — состав роли admin перечитан под замком, проверки счётчика нет', async () => {
    users.findCardById.mockResolvedValue(cardRow());

    await service.deactivateUser('user-1', actor());

    expect(roles.lockByCodeForUpdate).toHaveBeenCalledWith('admin', 'tx-handle');
    expect(roles.countActiveDirectMembers).not.toHaveBeenCalled();
  });
});
