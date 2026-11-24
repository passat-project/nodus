import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { DepartmentsService } from './departments.service.js';

const actor = (permissions: string[] = []): AuthUser => ({
  id: 'admin-1',
  email: 'a@b.by',
  displayName: 'Админ',
  permissions,
});

function row(id: string, parentId: string | null) {
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
    deputy: null,
    _count: { members: 0, legalMembers: 0 },
  };
}

/**
 * Архивация и перенос подразделения меняют действующие роли сотрудников
 * (#866, замечание валидатора): затронутые отзываются событием
 * `directory.role.access_changed` — права не живут в JWT до 15 минут.
 */
describe('DepartmentsService: отзыв доступа при изменении оргструктуры (#866)', () => {
  const departments = {
    clearHeadBesides: vi.fn().mockResolvedValue([]),
    clearDeputiesBesides: vi.fn().mockResolvedValue([]),
    setDeputies: vi.fn(),
    findById: vi.fn(),
    lockForUpdate: vi.fn(),
    lockTree: vi.fn(),
    update: vi.fn(),
    findParentChain: vi.fn(),
    findSubtreeIds: vi.fn(),
    findRef: vi.fn(),
    countActiveChildren: vi.fn(),
  };
  const users = { findActiveIdsByDepartmentIds: vi.fn(), findRef: vi.fn() };
  const positions = { findRef: vi.fn() };
  const roles = { permissionsByIds: vi.fn(), lockForUpdate: vi.fn(), lockByCodeForUpdate: vi.fn() };
  const membership = { effectiveRoleIds: vi.fn() };
  const audience = { roleIdsOfDepartments: vi.fn(), departmentUserIds: vi.fn() };
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
      { recomputeUsers: vi.fn(), recomputeDepartments: vi.fn() } as never,
    );
  });

  it('перенос меняет действующие роли — сотрудники поддерева отзываются', async () => {
    departments.findById.mockImplementation(async (foundId: string) =>
      foundId === 'dep' ? row('dep', 'old-parent') : row('new-parent', null),
    );
    departments.findParentChain.mockImplementation(async (startId: string) =>
      startId === 'old-parent' ? ['old-parent'] : ['new-parent'],
    );
    departments.findRef.mockResolvedValue({
      id: 'new-parent',
      kind: 'management',
      isActive: true,
    });
    departments.findSubtreeIds.mockResolvedValue(['dep']);
    users.findActiveIdsByDepartmentIds.mockResolvedValue(['u-1']);
    audience.roleIdsOfDepartments.mockResolvedValue(['role-old']);
    departments.update.mockResolvedValue(row('dep', 'new-parent'));

    await service.update('dep', { parentId: 'new-parent' }, actor());

    expect(audience.roleIdsOfDepartments).toHaveBeenCalledWith(
      ['old-parent', 'new-parent'],
      'tx-handle',
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      { roleId: 'role-old', reason: 'membership', userIds: ['u-1'] },
      expect.objectContaining({ actorId: 'admin-1', aggregateType: 'role' }),
    );
  });

  it('архивация снимает действующие роли сотрудников — токены отзываются', async () => {
    departments.findById.mockResolvedValue(row('dep', null));
    audience.roleIdsOfDepartments.mockResolvedValue(['role-dept']);
    audience.departmentUserIds.mockResolvedValue(['u-1', 'u-2']);

    await service.archive('dep', 'admin-1');

    expect(audience.roleIdsOfDepartments).toHaveBeenCalledWith(['dep'], 'tx-handle');
    expect(audience.departmentUserIds).toHaveBeenCalledWith('dep', 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      { roleId: 'role-dept', reason: 'membership', userIds: ['u-1', 'u-2'] },
      expect.objectContaining({ actorId: 'admin-1', aggregateType: 'role' }),
    );
  });

  it('архивация узла без привязанных ролей — только department.archived', async () => {
    departments.findById.mockResolvedValue(row('dep', null));
    audience.departmentUserIds.mockResolvedValue(['u-1']);

    await service.archive('dep', 'admin-1');

    expect(eventBus.emit).not.toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      expect.anything(),
      expect.anything(),
    );
  });
});
