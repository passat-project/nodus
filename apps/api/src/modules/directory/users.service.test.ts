import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, Permission, type AuthUser, type CreateUserDto } from '@nodus/contracts';

import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { UsersService } from './users.service.js';

const CREATE_DTO: CreateUserDto = {
  email: 'new@nodus.by',
  password: 'Start!23456789',
  lastName: 'Новый',
  firstName: 'Сотрудник',
  middleName: null,
  managerId: null,
  departmentId: null,
  positionId: null,
  legalDepartmentId: null,
  legalPositionId: null,
  roleIds: ['role-1'],
};

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

describe('UsersService: создание и правка сотрудника', () => {
  const users = {
    findPage: vi.fn(),
    findCardById: vi.fn(),
    emailExists: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setRoles: vi.fn(),
    findRef: vi.fn(),
  };
  const departments = { findRef: vi.fn() };
  const positions = { findRef: vi.fn() };
  const roles = {
    countByIds: vi.fn(),
    permissionsByIds: vi.fn(),
    lockForUpdate: vi.fn(),
    lockByCodeForUpdate: vi.fn(),
    countActiveDirectMembers: vi.fn(),
  };
  /** Эффективные роли (порт): по умолчанию — без добавившихся. */
  const membership = { effectiveRoleIds: vi.fn() };
  const passwords = { hash: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: UsersService;

  beforeEach(() => {
    vi.resetAllMocks();
    membership.effectiveRoleIds.mockResolvedValue([]);
    roles.lockByCodeForUpdate.mockResolvedValue(null);
    const guard = new RoleAssignmentGuard(roles as never, membership as never);
    const references = new ReferenceGuard(users as never, departments as never, positions as never);
    service = new UsersService(
      users as never,
      roles as never,
      passwords as never,
      tx as never,
      eventBus as never,
      { fileContentUrl: vi.fn((id: string) => `/files/${id}/content`) } as never,
      guard,
      references,
      { process: vi.fn() } as never,
    );
  });

  describe('createUser', () => {
    it('создаёт с хэшем пароля и событием в той же транзакции', async () => {
      users.emailExists.mockResolvedValue(false);
      roles.countByIds.mockResolvedValue(1);
      passwords.hash.mockResolvedValue('argon2-hash');
      users.create.mockResolvedValue(cardRow());
      users.findCardById.mockResolvedValue(cardRow());
      // Порт после вставки видит прямые роли нового сотрудника; права роли — у актора.
      membership.effectiveRoleIds.mockResolvedValue(['role-1']);
      roles.permissionsByIds.mockResolvedValue(new Map([['role-1', [Permission.TASK_CREATE]]]));

      const card = await service.createUser(CREATE_DTO, actor([Permission.TASK_CREATE]));

      expect(passwords.hash).toHaveBeenCalledWith('Start!23456789');
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@nodus.by',
          passwordHash: 'argon2-hash',
          displayName: 'Новый Сотрудник',
        }),
        'tx-handle',
      );
      expect(users.setRoles).toHaveBeenCalledWith('user-1', ['role-1'], 'tx-handle');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.user.created',
        { userId: 'user-1', email: 'new@nodus.by' },
        expect.objectContaining({ actorId: 'admin-1' }),
      );
      expect(card.email).toBe('new@nodus.by');
    });

    it('занятый email → DIRECTORY_EMAIL_TAKEN, создания нет', async () => {
      users.emailExists.mockResolvedValue(true);

      await expect(service.createUser(CREATE_DTO, actor())).rejects.toMatchObject({
        code: ErrorCode.DIRECTORY_EMAIL_TAKEN,
      });
      expect(users.create).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('неизвестные роли → VALIDATION_FAILED', async () => {
      users.emailExists.mockResolvedValue(false);
      roles.countByIds.mockResolvedValue(0);

      await expect(service.createUser(CREATE_DTO, actor())).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
    });

    it('ссылка на несуществующего руководителя → 400 DIRECTORY_REFERENCE_INVALID', async () => {
      users.emailExists.mockResolvedValue(false);
      roles.countByIds.mockResolvedValue(1);
      users.findRef.mockResolvedValue(null);

      await expect(
        service.createUser({ ...CREATE_DTO, managerId: 'ghost' }, actor()),
      ).rejects.toMatchObject({
        code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
        details: { field: 'managerId', reason: 'not_found' },
      });
      expect(users.create).not.toHaveBeenCalled();
    });

    it('подразделение чужого вида структуры → 400 kind_mismatch (#441)', async () => {
      users.emailExists.mockResolvedValue(false);
      roles.countByIds.mockResolvedValue(1);
      departments.findRef.mockResolvedValue({ id: 'dep-1', kind: 'legal', isActive: true });

      await expect(
        service.createUser({ ...CREATE_DTO, departmentId: 'dep-1' }, actor()),
      ).rejects.toMatchObject({
        code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
        details: { field: 'departmentId', reason: 'kind_mismatch' },
      });
    });

    it('bind (#490): явная роль с правами, которых нет у актора → 403 ROLE_PERMISSION_NOT_HELD', async () => {
      users.emailExists.mockResolvedValue(false);
      roles.countByIds.mockResolvedValue(1);
      users.create.mockResolvedValue(cardRow());
      // Порт после вставки возвращает назначенные прямые роли сотрудника.
      membership.effectiveRoleIds.mockResolvedValue(['role-1']);
      roles.permissionsByIds.mockResolvedValue(new Map([['role-1', [Permission.WORKFLOW_MANAGE]]]));

      await expect(
        service.createUser(CREATE_DTO, actor([Permission.TASK_CREATE])),
      ).rejects.toMatchObject({
        code: ErrorCode.ROLE_PERMISSION_NOT_HELD,
        details: { permissions: [Permission.WORKFLOW_MANAGE] },
      });
      // Якорь порядка замков bind-пути: admin первым, затем добавленная роль.
      expect(roles.lockByCodeForUpdate).toHaveBeenCalledWith('admin', 'tx-handle');
      expect(roles.lockForUpdate).toHaveBeenCalledWith('role-1', 'tx-handle');
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('bind (#490): неявная роль подразделения сверх прав актора → 403', async () => {
      users.emailExists.mockResolvedValue(false);
      roles.countByIds.mockResolvedValue(0);
      users.create.mockResolvedValue(cardRow({ departmentId: 'dep-1' }));
      departments.findRef.mockResolvedValue({ id: 'dep-1', kind: 'management', isActive: true });
      // Прямых ролей нет (roleIds: []), подразделение добавляет связанную.
      membership.effectiveRoleIds.mockResolvedValue(['role-dept']);
      roles.permissionsByIds.mockResolvedValue(new Map([['role-dept', [Permission.CRM_MANAGE]]]));

      await expect(
        service.createUser({ ...CREATE_DTO, roleIds: [], departmentId: 'dep-1' }, actor()),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_PERMISSION_NOT_HELD });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('updateUser', () => {
    it('правка полей без ролей и подразделения — порт прав не вызывается', async () => {
      users.findCardById.mockResolvedValue(cardRow());

      await service.updateUser('user-1', { mobilePhone: '+375291234567' }, actor());

      expect(membership.effectiveRoleIds).not.toHaveBeenCalled();
      expect(users.setRoles).not.toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.user.updated',
        expect.objectContaining({ userId: 'user-1' }),
        expect.anything(),
      );
    });

    it('добавляет роль, все права которой есть у актора', async () => {
      users.findCardById.mockResolvedValue(cardRow());
      roles.countByIds.mockResolvedValue(1);
      membership.effectiveRoleIds.mockResolvedValueOnce([]).mockResolvedValueOnce(['role-1']);
      roles.permissionsByIds.mockResolvedValue(new Map([['role-1', [Permission.TASK_CREATE]]]));

      await service.updateUser('user-1', { roleIds: ['role-1'] }, actor([Permission.TASK_CREATE]));

      expect(users.setRoles).toHaveBeenCalledWith('user-1', ['role-1'], 'tx-handle');
      // bind реально посчитал права добавленной роли, а не вышел по пустому diff.
      expect(roles.permissionsByIds).toHaveBeenCalledWith(['role-1'], 'tx-handle');
    });

    it('bind (#490): добавленная роль с чужими правами → 403', async () => {
      users.findCardById.mockResolvedValue(cardRow());
      roles.countByIds.mockResolvedValue(1);
      membership.effectiveRoleIds.mockResolvedValueOnce([]).mockResolvedValueOnce(['role-1']);
      roles.permissionsByIds.mockResolvedValue(
        new Map([['role-1', [Permission.DIRECTORY_MANAGE]]]),
      );

      await expect(
        service.updateUser('user-1', { roleIds: ['role-1'] }, actor([Permission.TASK_CREATE])),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_PERMISSION_NOT_HELD });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('снятие роли правами не ограничено — даже роли с чужими правами', async () => {
      users.findCardById.mockResolvedValue(
        withRoles([{ id: 'role-1', code: 'editor', name: 'Р' }]),
      );
      roles.countByIds.mockResolvedValue(0);
      membership.effectiveRoleIds.mockResolvedValueOnce(['role-1']).mockResolvedValueOnce([]);

      await service.updateUser('user-1', { roleIds: [] }, actor());

      expect(users.setRoles).toHaveBeenCalledWith('user-1', [], 'tx-handle');
      expect(roles.permissionsByIds).not.toHaveBeenCalled();
    });

    it('bind (#490): перевод в подразделение с привязанной ролью → 403', async () => {
      users.findCardById.mockResolvedValue(cardRow());
      departments.findRef.mockResolvedValue({ id: 'dep-1', kind: 'management', isActive: true });
      // «До» — без ролей, «после» перевода подразделение добавляет свою роль.
      membership.effectiveRoleIds.mockResolvedValueOnce([]).mockResolvedValueOnce(['role-dept']);
      roles.permissionsByIds.mockResolvedValue(new Map([['role-dept', [Permission.CRM_MANAGE]]]));

      await expect(
        service.updateUser('user-1', { departmentId: 'dep-1' }, actor()),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_PERMISSION_NOT_HELD });
    });

    it('перевод в подразделение, роль которого у сотрудника уже есть — разрешён', async () => {
      users.findCardById.mockResolvedValue(cardRow());
      departments.findRef.mockResolvedValue({ id: 'dep-1', kind: 'management', isActive: true });
      membership.effectiveRoleIds.mockResolvedValue(['role-dept']);
      roles.permissionsByIds.mockResolvedValue(new Map([['role-dept', [Permission.CRM_MANAGE]]]));

      await service.updateUser('user-1', { departmentId: 'dep-1' }, actor([Permission.CRM_MANAGE]));

      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('последний администратор: снятие роли admin → 409 ROLE_LAST_ADMIN под замком', async () => {
      users.findCardById.mockResolvedValue(
        withRoles([{ id: 'role-admin', code: 'admin', name: 'Администратор' }]),
      );
      roles.countByIds.mockResolvedValue(0);
      roles.lockByCodeForUpdate.mockResolvedValue('role-admin');
      roles.countActiveDirectMembers.mockResolvedValue(0);

      await expect(
        service.updateUser('user-1', { roleIds: [] }, actor([Permission.CORE_ADMIN])),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_LAST_ADMIN });
      expect(roles.lockByCodeForUpdate).toHaveBeenCalledWith('admin', 'tx-handle');
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('снятие роли admin, когда есть другой активный участник — разрешено', async () => {
      users.findCardById.mockResolvedValue(
        withRoles([{ id: 'role-admin', code: 'admin', name: 'Администратор' }]),
      );
      roles.countByIds.mockResolvedValue(0);
      roles.lockByCodeForUpdate.mockResolvedValue('role-admin');
      roles.countActiveDirectMembers.mockResolvedValue(2);

      await service.updateUser('user-1', { roleIds: [] }, actor([Permission.CORE_ADMIN]));

      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('руководитель — сам сотрудник → 400 self (#441)', async () => {
      users.findCardById.mockResolvedValue(cardRow());

      await expect(
        service.updateUser('user-1', { managerId: 'user-1' }, actor()),
      ).rejects.toMatchObject({
        code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
        details: { field: 'managerId', reason: 'self' },
      });
      expect(users.update).not.toHaveBeenCalled();
    });

    it('неактивная должность → 400 inactive (#441)', async () => {
      users.findCardById.mockResolvedValue(cardRow());
      positions.findRef.mockResolvedValue({ id: 'pos-1', kind: 'management', isActive: false });

      await expect(
        service.updateUser('user-1', { positionId: 'pos-1' }, actor()),
      ).rejects.toMatchObject({
        code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
        details: { field: 'positionId', reason: 'inactive' },
      });
    });

    it('очистка ссылок (null) проходит без проверок (#441)', async () => {
      users.findCardById.mockResolvedValue(cardRow());

      await service.updateUser(
        'user-1',
        { managerId: null, departmentId: null, positionId: null },
        actor(),
      );

      expect(users.findRef).not.toHaveBeenCalled();
      expect(departments.findRef).not.toHaveBeenCalled();
      expect(positions.findRef).not.toHaveBeenCalled();
      expect(users.update).toHaveBeenCalled();
    });
  });
});
