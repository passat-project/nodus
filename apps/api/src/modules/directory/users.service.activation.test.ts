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
    status: 'deactivated',
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

/** Возврат деактивированного сотрудника в работу (AUD-016). */
describe('UsersService: активация сотрудника', () => {
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
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: UsersService;

  beforeEach(() => {
    vi.resetAllMocks();
    membership.effectiveRoleIds.mockResolvedValue([]);
    roles.lockByCodeForUpdate.mockResolvedValue(null);
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
      { findParentChain: vi.fn(), findNamesByIds: vi.fn() } as never,
      { process: vi.fn() } as never,
      { subordinateIds: vi.fn(), managerChainOf: vi.fn() } as never,
    );
  });

  it('деактивирован → статус active и событие directory.user.activated', async () => {
    users.findCardById.mockResolvedValueOnce(cardRow({ status: 'deactivated' }));
    users.findCardById.mockResolvedValueOnce(cardRow({ status: 'active' }));

    const result = await service.activateUser('user-1', actor());

    expect(users.update).toHaveBeenCalledWith('user-1', { status: 'active' }, 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.user.activated',
      { userId: 'user-1' },
      expect.objectContaining({ actorId: 'admin-1', aggregateType: 'user', aggregateId: 'user-1' }),
    );
    expect(result).toMatchObject({ id: 'user-1', status: 'active' });
  });

  it('идемпотентна: уже активен — без записи и без события', async () => {
    users.findCardById.mockResolvedValue(cardRow({ status: 'active' }));

    const result = await service.activateUser('user-1', actor());

    expect(users.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'user-1', status: 'active' });
  });

  it('не найден → NOT_FOUND', async () => {
    users.findCardById.mockResolvedValue(null);

    await expect(service.activateUser('nope', actor())).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(users.update).not.toHaveBeenCalled();
  });
});
