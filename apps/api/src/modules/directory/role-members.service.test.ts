import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';

import { RoleMembersService } from './role-members.service.js';

function record(overrides: Record<string, unknown> = {}) {
  return {
    row: {
      id: 'role-1',
      code: 'editor',
      name: 'Редактор',
      description: null,
      isSystem: false,
      permissions: [{ permission: Permission.TASK_CREATE }],
      _count: { users: 1, departments: 0 },
      ...overrides,
    },
    preview: [],
  };
}

const actor = (permissions: string[] = []) => ({
  id: 'admin-1',
  email: 'a@b.by',
  displayName: 'Админ',
  permissions,
});

describe('RoleMembersService (#379)', () => {
  const roles = {
    findById: vi.fn(),
    lockForUpdate: vi.fn(),
    findMembers: vi.fn(),
    findActiveUser: vi.fn(),
    findAssignableDepartment: vi.fn(),
    countActiveDirectMembers: vi.fn(),
    addUser: vi.fn(),
    removeUser: vi.fn(),
    addDepartment: vi.fn(),
    removeDepartment: vi.fn(),
  };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };
  const signedUrls = { fileContentUrl: (id: string) => `/api/v1/files/${id}/content` };
  const audience = { departmentUserIds: vi.fn() };

  let service: RoleMembersService;

  beforeEach(() => {
    vi.clearAllMocks();
    roles.lockForUpdate.mockResolvedValue(true);
    roles.findById.mockResolvedValue(record());
    roles.findActiveUser.mockResolvedValue(true);
    roles.findAssignableDepartment.mockResolvedValue(true);
    audience.departmentUserIds.mockResolvedValue([]);
    service = new RoleMembersService(
      roles as never,
      tx as never,
      eventBus as never,
      signedUrls as never,
      audience as never,
    );
  });

  it('добавление сотрудника: замок → цель → bind → запись → событие', async () => {
    roles.addUser.mockResolvedValue(true);

    await service.setUserMember('role-1', 'user-1', true, actor([Permission.TASK_CREATE]));

    expect(roles.lockForUpdate).toHaveBeenCalledWith('role-1', 'tx-handle');
    expect(roles.addUser).toHaveBeenCalledWith('role-1', 'user-1', 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.members_changed',
      { roleId: 'role-1', kind: 'user', targetId: 'user-1', added: true },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
  });

  it('снятие сотрудника из роли: событие доступа для отзыва его токена', async () => {
    roles.removeUser.mockResolvedValue(true);

    await service.setUserMember('role-1', 'user-1', false, actor());

    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      { roleId: 'role-1', reason: 'membership', userIds: ['user-1'] },
      expect.objectContaining({ actorId: 'admin-1', aggregateId: 'role-1' }),
    );
  });

  it('добавление в роль: токен со старыми правами тоже отзывается', async () => {
    roles.addUser.mockResolvedValue(true);

    await service.setUserMember('role-1', 'user-1', true, actor([Permission.TASK_CREATE]));

    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      { roleId: 'role-1', reason: 'membership', userIds: ['user-1'] },
      expect.anything(),
    );
  });

  it('подразделение в роли: отзыв токенов сотрудников поддерева', async () => {
    roles.addDepartment.mockResolvedValue(true);
    audience.departmentUserIds.mockResolvedValue(['u2', 'u3']);

    await service.setDepartmentMember('role-1', 'dep-1', true, actor(Object.values(Permission)));

    expect(audience.departmentUserIds).toHaveBeenCalledWith('dep-1', 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      { roleId: 'role-1', reason: 'membership', userIds: ['u2', 'u3'] },
      expect.anything(),
    );
  });

  it('повторное добавление идемпотентно: события нет', async () => {
    roles.addUser.mockResolvedValue(false);

    await service.setUserMember('role-1', 'user-1', true, actor([Permission.TASK_CREATE]));

    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('bind: без прав роли → 403 и записи нет', async () => {
    await expect(
      service.setUserMember('role-1', 'user-1', true, actor([Permission.ROLE_MANAGE])),
    ).rejects.toMatchObject({
      code: ErrorCode.ROLE_PERMISSION_NOT_HELD,
      details: { permissions: [Permission.TASK_CREATE] },
    });
    expect(roles.addUser).not.toHaveBeenCalled();
  });

  it('подразделение в роли «Администратор» → 409 ROLE_LOCKED (reason departments)', async () => {
    roles.findById.mockResolvedValue(record({ code: 'admin' }));

    await expect(
      service.setDepartmentMember('role-1', 'dep-1', true, actor(Object.values(Permission))),
    ).rejects.toMatchObject({
      code: ErrorCode.ROLE_LOCKED,
      details: { reason: 'departments' },
    });
    expect(roles.addDepartment).not.toHaveBeenCalled();
  });

  it('последний администратор: удаление опустошает состав → 409', async () => {
    roles.findById.mockResolvedValue(record({ code: 'admin' }));
    roles.removeUser.mockResolvedValue(true);
    roles.countActiveDirectMembers.mockResolvedValue(0);

    await expect(
      service.setUserMember('role-1', 'user-1', false, actor(Object.values(Permission))),
    ).rejects.toMatchObject({ code: ErrorCode.ROLE_LAST_ADMIN });
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('удаление не-участника → 200 без события', async () => {
    roles.removeUser.mockResolvedValue(false);

    await service.setUserMember('role-1', 'user-9', false, actor());

    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('цель не найдена или не активна → 400 VALIDATION_FAILED', async () => {
    roles.findActiveUser.mockResolvedValue(false);
    await expect(
      service.setUserMember('role-1', 'user-1', true, actor([Permission.TASK_CREATE])),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      details: { userId: 'user-1' },
    });

    roles.findAssignableDepartment.mockResolvedValue(false);
    await expect(
      service.setDepartmentMember('role-1', 'dep-1', true, actor([Permission.TASK_CREATE])),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      details: { departmentId: 'dep-1' },
    });
  });

  it('роли нет → 404', async () => {
    roles.lockForUpdate.mockResolvedValue(false);

    await expect(
      service.setUserMember('role-1', 'user-1', true, actor([Permission.TASK_CREATE])),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('состав читается с подписанными аватарами', async () => {
    roles.findMembers.mockResolvedValue({
      users: [{ id: 'u1', displayName: 'Анна', avatarFileId: 'file-1' }],
      departments: [{ id: 'd1', name: 'BIM-отдел' }],
    });

    const members = await service.listMembers('role-1');

    expect(members.users[0]).toEqual({
      id: 'u1',
      displayName: 'Анна',
      avatarUrl: '/api/v1/files/file-1/content',
    });
    expect(members.departments).toEqual([{ id: 'd1', name: 'BIM-отдел' }]);
  });
});
