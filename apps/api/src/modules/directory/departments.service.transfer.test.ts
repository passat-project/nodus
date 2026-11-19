import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, Permission, type AuthUser } from '@nodus/contracts';

import { ReferenceGuard } from './reference-guard.service.js';
import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { DepartmentsService } from './departments.service.js';

/**
 * #946: назначение главы/зама в окне подразделения переводит сотрудника в это
 * подразделение (одно место в управленческой структуре). Правило — для
 * управленческой структуры; юридическая формальная и не переводит. Уже
 * состоящий сотрудник — без записей/событий; глава и зам — разные люди.
 */

const actor = (permissions: string[] = []): AuthUser => ({
  id: 'admin-1',
  email: 'a@b.by',
  displayName: 'Админ',
  permissions,
});

function row(
  id: string,
  parentId: string | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: id,
    kind: 'management',
    parentId,
    headId: null,
    deputyId: null,
    sortOrder: 0,
    isActive: true,
    head: null,
    deputy: null,
    _count: { members: 0, legalMembers: 0 },
    ...overrides,
  };
}

describe('DepartmentsService: назначение главы/зама переводит сотрудника (#946)', () => {
  const departments = {
    findAllByKind: vi.fn(),
    findById: vi.fn(),
    lockForUpdate: vi.fn(),
    lockTree: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findParentChain: vi.fn(),
    findSubtreeIds: vi.fn(),
    findRef: vi.fn(),
    countActiveChildren: vi.fn(),
    clearLeadershipIn: vi.fn(),
  };
  const users = {
    findActiveIdsByDepartmentIds: vi.fn(),
    findRef: vi.fn(),
    findDepartmentId: vi.fn(),
    update: vi.fn(),
  };
  const positions = { findRef: vi.fn() };
  const roles = { permissionsByIds: vi.fn(), lockForUpdate: vi.fn(), lockByCodeForUpdate: vi.fn() };
  const membership = { effectiveRoleIds: vi.fn() };
  const audience = { roleIdsOfDepartments: vi.fn(), departmentUserIds: vi.fn() };
  const managers = { recomputeUsers: vi.fn(), recomputeDepartments: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: DepartmentsService;

  beforeEach(() => {
    vi.resetAllMocks();
    membership.effectiveRoleIds.mockResolvedValue([]);
    audience.roleIdsOfDepartments.mockResolvedValue([]);
    audience.departmentUserIds.mockResolvedValue([]);
    departments.lockForUpdate.mockResolvedValue(true);
    departments.countActiveChildren.mockResolvedValue(0);
    departments.clearLeadershipIn.mockResolvedValue(null);
    users.findRef.mockResolvedValue({ id: 'u-1', status: 'active' });
    users.findDepartmentId.mockResolvedValue('dep-old');
    users.update.mockResolvedValue({});
    const guard = new RoleAssignmentGuard(roles as never, membership as never);
    const references = new ReferenceGuard(users as never, departments as never, positions as never);
    service = new DepartmentsService(
      departments as never,
      users as never,
      guard,
      references,
      tx as never,
      eventBus as never,
      audience as never,
      managers as never,
    );
  });

  const emitted = (type: string) =>
    (eventBus.emit.mock.calls as unknown as [string, string, Record<string, unknown>][])
      .filter((call) => call[1] === type)
      .map((call) => call[2]);

  it('правка главы переводит сотрудника в узел: роли, руководитель, события', async () => {
    departments.findById.mockResolvedValue(row('dep', null));
    departments.update.mockResolvedValue(row('dep', null, { headId: 'u-1' }));
    departments.clearLeadershipIn.mockResolvedValue({ head: true, deputy: false });

    await service.update('dep', { headId: 'u-1' }, actor());

    // #544/#946: назначение главы — под advisory-локом дерева.
    expect(departments.lockTree).toHaveBeenCalledWith('tx-handle');
    // Старый узел теряет роль — событие с реальными changedFields.
    expect(departments.clearLeadershipIn).toHaveBeenCalledWith('dep-old', 'u-1', 'tx-handle');
    expect(emitted('directory.department.updated')).toContainEqual({
      departmentId: 'dep-old',
      changedFields: ['headId'],
    });
    // Сотрудник переведён и руководитель пересчитан.
    expect(users.update).toHaveBeenCalledWith('u-1', { departmentId: 'dep' }, 'tx-handle');
    expect(managers.recomputeUsers).toHaveBeenCalledWith(['u-1'], 'tx-handle');
    expect(emitted('directory.user.updated')).toEqual([
      { userId: 'u-1', changedFields: ['departmentId'] },
    ]);
    expect(managers.recomputeDepartments).toHaveBeenCalledWith(['dep'], 'tx-handle');
  });

  it('правка зама переводит так же', async () => {
    departments.findById.mockResolvedValue(row('dep', null));
    departments.update.mockResolvedValue(row('dep', null, { deputyId: 'u-1' }));

    await service.update('dep', { deputyId: 'u-1' }, actor());

    expect(users.update).toHaveBeenCalledWith('u-1', { departmentId: 'dep' }, 'tx-handle');
    expect(emitted('directory.user.updated')).toEqual([
      { userId: 'u-1', changedFields: ['departmentId'] },
    ]);
  });

  it('уже состоящий в узле сотрудник — без записей, отзыва токенов и user.updated', async () => {
    departments.findById.mockResolvedValue(row('dep', null));
    departments.update.mockResolvedValue(row('dep', null, { headId: 'u-1' }));
    users.findDepartmentId.mockResolvedValue('dep');

    await service.update('dep', { headId: 'u-1' }, actor());

    expect(departments.clearLeadershipIn).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
    expect(managers.recomputeUsers).not.toHaveBeenCalled();
    expect(emitted('directory.user.updated')).toEqual([]);
    expect(emitted('directory.role.access_changed')).toEqual([]);
  });

  it('глава и зам — один человек → 400, мутации нет', async () => {
    departments.findById.mockResolvedValue(row('dep', null));

    await expect(
      service.update('dep', { headId: 'u-1', deputyId: 'U-1' }, actor()),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      details: { field: 'deputyId', reason: 'same_as_head' },
    });
    expect(departments.update).not.toHaveBeenCalled();
  });

  it('очистка главы (null) — перевода нет', async () => {
    departments.findById.mockResolvedValue(row('dep', null, { headId: 'u-1' }));
    departments.update.mockResolvedValue(row('dep', null, { headId: null }));

    await service.update('dep', { headId: null }, actor());

    expect(users.findDepartmentId).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('создание с главой из другого подразделения переводит его', async () => {
    departments.create.mockResolvedValue(row('new-dep', null, { headId: 'u-1' }));

    await service.create(
      {
        name: 'Новый узел',
        kind: 'management',
        parentId: null,
        headId: 'u-1',
        deputyId: null,
        sortOrder: 0,
      },
      actor(),
    );

    expect(users.findDepartmentId).toHaveBeenCalledWith('u-1', 'tx-handle');
    expect(users.update).toHaveBeenCalledWith('u-1', { departmentId: 'new-dep' }, 'tx-handle');
    expect(emitted('directory.user.updated')).toEqual([
      { userId: 'u-1', changedFields: ['departmentId'] },
    ]);
  });

  it('юридическая структура формальная: назначение не переводит сотрудника', async () => {
    departments.create.mockResolvedValue(row('legal-dep', null, { kind: 'legal', headId: 'u-1' }));

    await service.create(
      {
        name: 'Юрлицо',
        kind: 'legal',
        parentId: null,
        headId: 'u-1',
        deputyId: null,
        sortOrder: 0,
      },
      actor(),
    );

    expect(users.findDepartmentId).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('bind (#490): роль узла сверх прав актора — 403, user.updated не эмитится', async () => {
    departments.findById.mockResolvedValue(row('dep', null));
    departments.update.mockResolvedValue(row('dep', null, { headId: 'u-1' }));
    membership.effectiveRoleIds.mockResolvedValueOnce([]).mockResolvedValueOnce(['role-dept']);
    roles.permissionsByIds.mockResolvedValue(new Map([['role-dept', [Permission.CRM_MANAGE]]]));

    await expect(service.update('dep', { headId: 'u-1' }, actor())).rejects.toMatchObject({
      code: ErrorCode.ROLE_PERMISSION_NOT_HELD,
    });
    expect(emitted('directory.user.updated')).toEqual([]);
  });

  it('перевод, добавивший роль из прав актора: access_changed отзывает токены', async () => {
    departments.findById.mockResolvedValue(row('dep', null));
    departments.update.mockResolvedValue(row('dep', null, { headId: 'u-1' }));
    membership.effectiveRoleIds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['role-read'])
      .mockResolvedValueOnce(['role-read']);
    roles.permissionsByIds.mockResolvedValue(new Map([['role-read', [Permission.DIRECTORY_READ]]]));

    await service.update('dep', { headId: 'u-1' }, actor([Permission.DIRECTORY_READ]));

    expect(emitted('directory.role.access_changed')).toEqual([
      { roleId: 'role-read', reason: 'membership', userIds: ['u-1'] },
    ]);
  });
});
