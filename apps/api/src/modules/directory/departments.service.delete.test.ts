import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser } from '@nodus/contracts';

import { ReferenceGuard } from './reference-guard.service.js';
import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { DepartmentsService } from './departments.service.js';

/**
 * #881: жёсткое удаление подразделения с переносом. Дети и прямые сотрудники
 * (включая уволенных) уходят к родителю, managerId пересчитывается, роли узла
 * снимаются каскадом, активным сотрудникам поддерева отзываются access-токены.
 * Главная карточка (корень) и legal-узлы не удаляются.
 */

const actor: AuthUser = {
  id: 'admin-1',
  email: 'a@b.by',
  displayName: 'Админ',
  permissions: [],
};

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
    deputyIds: [],
    sortOrder: 0,
    isActive: true,
    head: null,
    deputies: [],
    _count: { members: 0, legalMembers: 0 },
    ...overrides,
  };
}

describe('DepartmentsService: удаление подразделения с переносом (#881)', () => {
  const departments = {
    lockTree: vi.fn(),
    lockForUpdate: vi.fn(),
    findById: vi.fn(),
    findDirectChildIds: vi.fn(),
    reparentChildren: vi.fn(),
    deleteById: vi.fn(),
  };
  const users = {
    findIdsByDepartmentId: vi.fn(),
    moveDepartment: vi.fn(),
    findActiveIdsByDepartmentIds: vi.fn(),
    findRef: vi.fn(),
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
    departments.findDirectChildIds.mockResolvedValue([]);
    users.findIdsByDepartmentId.mockResolvedValue([]);
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

  it('переносит детей и прямых сотрудников к родителю, удаляет строку и шлёт событие', async () => {
    departments.findById.mockResolvedValue(row('dep', 'parent', { name: 'BIM-отдел' }));
    departments.findDirectChildIds.mockResolvedValue(['child-1', 'child-2']);
    users.findIdsByDepartmentId.mockResolvedValue(['u-1', 'u-2']);

    await service.delete('dep', actor);

    expect(departments.reparentChildren).toHaveBeenCalledWith('dep', 'parent', 'tx-handle');
    expect(users.moveDepartment).toHaveBeenCalledWith(['u-1', 'u-2'], 'parent', 'tx-handle');
    expect(departments.deleteById).toHaveBeenCalledWith('dep', 'tx-handle');
    expect(managers.recomputeUsers).toHaveBeenCalledWith(['u-1', 'u-2'], 'tx-handle');
    expect(managers.recomputeDepartments).toHaveBeenCalledWith(['child-1', 'child-2'], 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.department.deleted',
      {
        departmentId: 'dep',
        name: 'BIM-отдел',
        parentId: 'parent',
        childDepartmentIds: ['child-1', 'child-2'],
        userIds: ['u-1', 'u-2'],
      },
      expect.objectContaining({
        actorId: 'admin-1',
        aggregateType: 'department',
        aggregateId: 'dep',
      }),
    );
  });

  it('снимает роли узла и отзывает access-токены активных сотрудников поддерева', async () => {
    departments.findById.mockResolvedValue(row('dep', 'parent'));
    audience.roleIdsOfDepartments.mockResolvedValue(['role-1']);
    audience.departmentUserIds.mockResolvedValue(['u-1', 'u-3']);

    await service.delete('dep', actor);

    expect(audience.roleIdsOfDepartments).toHaveBeenCalledWith(['dep'], 'tx-handle');
    expect(audience.departmentUserIds).toHaveBeenCalledWith('dep', 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      { roleId: 'role-1', reason: 'membership', userIds: ['u-1', 'u-3'] },
      expect.objectContaining({ actorId: 'admin-1', aggregateType: 'role' }),
    );
  });

  it('без привязок ролей access_changed не эмитится', async () => {
    departments.findById.mockResolvedValue(row('dep', 'parent'));
    audience.departmentUserIds.mockResolvedValue(['u-1']);

    await service.delete('dep', actor);

    expect(eventBus.emit).not.toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      expect.anything(),
      expect.anything(),
    );
  });

  it('юридическое подразделение не удаляется', async () => {
    departments.findById.mockResolvedValue(row('dep', 'parent', { kind: 'legal' }));

    await expect(service.delete('dep', actor)).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_DEPARTMENT_LEGAL_FORBIDDEN,
      details: { id: 'dep' },
    });
    expect(departments.deleteById).not.toHaveBeenCalled();
    expect(users.moveDepartment).not.toHaveBeenCalled();
  });

  it('главная карточка / второй корень не удаляется', async () => {
    departments.findById.mockResolvedValue(row('root', null));

    await expect(service.delete('root', actor)).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
      details: { id: 'root', reason: 'root' },
    });
    expect(departments.deleteById).not.toHaveBeenCalled();
  });

  it('несуществующий узел — 404 без мутаций', async () => {
    departments.lockForUpdate.mockResolvedValue(false);

    await expect(service.delete('missing', actor)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(departments.deleteById).not.toHaveBeenCalled();
  });
});
