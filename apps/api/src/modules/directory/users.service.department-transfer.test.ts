import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { UsersService } from './users.service.js';

/**
 * Перевод сотрудника между подразделениями (#923, приёмка 18.11.2026): один
 * сотрудник — одно место в управленческой структуре. Роль главы/зама
 * принадлежит подразделению, поэтому при смене `departmentId` её теряет ТОЛЬКО
 * старый отдел (включая перевод в «не выбрано»), подчинённые пересчитываются,
 * узел сообщает `department.updated`; «то же подразделение» — no-op.
 */

const actor: AuthUser = {
  id: 'admin-1',
  email: 'a@b.by',
  displayName: 'Админ',
  permissions: [],
};

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
    departmentId: 'dep-old',
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

describe('UsersService.updateUser: перевод главы/зама (#923)', () => {
  const users = {
    findCardById: vi.fn(),
    update: vi.fn(),
    setRoles: vi.fn(),
    create: vi.fn(),
    emailExists: vi.fn(),
    findRef: vi.fn(),
  };
  const departments = { findRef: vi.fn() };
  const departmentsRepo = {
    findParentChain: vi.fn(),
    findNamesByIds: vi.fn(),
    clearHeadAndDeputy: vi.fn(),
    clearLeadershipIn: vi.fn(),
  };
  const managers = { recomputeUsers: vi.fn(), recomputeDepartments: vi.fn() };
  const positions = { findRef: vi.fn(), lockMany: vi.fn() };
  const roles = {
    countByIds: vi.fn(),
    permissionsByIds: vi.fn(),
    lockForUpdate: vi.fn(),
    lockByCodeForUpdate: vi.fn(),
    countActiveDirectMembers: vi.fn(),
  };
  const membership = { effectiveRoleIds: vi.fn() };
  const passwords = { hash: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: UsersService;

  beforeEach(() => {
    vi.resetAllMocks();
    membership.effectiveRoleIds.mockResolvedValue([]);
    roles.lockByCodeForUpdate.mockResolvedValue(null);
    departmentsRepo.clearLeadershipIn.mockResolvedValue(null);
    departments.findRef.mockResolvedValue({ id: 'dep-new', kind: 'management', isActive: true });
    users.findCardById.mockResolvedValue(cardRow());
    const guard = new RoleAssignmentGuard(roles as never, membership as never);
    const references = new ReferenceGuard(users as never, departments as never, positions as never);
    service = new UsersService(
      users as never,
      roles as never,
      passwords as never,
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

  const departmentEvents = () =>
    (
      eventBus.emit.mock.calls as unknown as [
        string,
        string,
        { departmentId: string; changedFields: string[] },
      ][]
    )
      .filter((call) => call[1] === 'directory.department.updated')
      .map((call) => call[2]);

  it('обычный сотрудник: роль не снималась, собственный руководитель пересчитан', async () => {
    await service.updateUser('user-1', { departmentId: 'dep-new' }, actor);

    expect(departmentsRepo.clearLeadershipIn).toHaveBeenCalledWith(
      'dep-old',
      'user-1',
      'tx-handle',
    );
    expect(managers.recomputeUsers).toHaveBeenCalledWith(['user-1'], 'tx-handle');
    expect(managers.recomputeDepartments).not.toHaveBeenCalled();
    expect(departmentEvents()).toEqual([]);
  });

  it('глава: старый отдел теряет headId, подчинённые пересчитаны, department.updated', async () => {
    departmentsRepo.clearLeadershipIn.mockResolvedValue({ head: true, deputy: false });

    await service.updateUser('user-1', { departmentId: 'dep-new' }, actor);

    expect(managers.recomputeDepartments).toHaveBeenCalledWith(['dep-old'], 'tx-handle');
    expect(departmentEvents()).toEqual([{ departmentId: 'dep-old', changedFields: ['headId'] }]);
  });

  it('заместитель: старый отдел теряет deputyId', async () => {
    departmentsRepo.clearLeadershipIn.mockResolvedValue({ head: false, deputy: true });

    await service.updateUser('user-1', { departmentId: 'dep-new' }, actor);

    expect(departmentEvents()).toEqual([{ departmentId: 'dep-old', changedFields: ['deputyId'] }]);
  });

  it('перевод в «не выбрано» (null): старый отдел тоже очищается', async () => {
    departmentsRepo.clearLeadershipIn.mockResolvedValue({ head: true, deputy: true });

    await service.updateUser('user-1', { departmentId: null }, actor);

    expect(departmentsRepo.clearLeadershipIn).toHaveBeenCalledWith(
      'dep-old',
      'user-1',
      'tx-handle',
    );
    expect(departmentEvents()).toEqual([
      { departmentId: 'dep-old', changedFields: ['headId', 'deputyId'] },
    ]);
    expect(managers.recomputeUsers).toHaveBeenCalledWith(['user-1'], 'tx-handle');
  });

  it('то же подразделение — роль остаётся, лишних событий и пересчёта поддерева нет', async () => {
    await service.updateUser('user-1', { departmentId: 'dep-old' }, actor);

    expect(departmentsRepo.clearLeadershipIn).not.toHaveBeenCalled();
    expect(managers.recomputeDepartments).not.toHaveBeenCalled();
    expect(departmentEvents()).toEqual([]);
    // Собственный руководитель пересчитывается и на повторную установку отдела.
    expect(managers.recomputeUsers).toHaveBeenCalledWith(['user-1'], 'tx-handle');
  });

  it('правка без подразделения — руководящие ссылки не трогаются', async () => {
    await service.updateUser('user-1', { mobilePhone: '+375291234567' }, actor);

    expect(departmentsRepo.clearLeadershipIn).not.toHaveBeenCalled();
    expect(managers.recomputeUsers).not.toHaveBeenCalled();
  });
});
