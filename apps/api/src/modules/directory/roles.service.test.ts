import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';

import { RolesService } from './roles.service.js';

/** Строка роли в форме репозитория: `_count` и `preview` (ADR-0034). */
function record(overrides: Record<string, unknown> = {}) {
  return {
    row: {
      id: 'role-1',
      code: 'editor',
      name: 'Редактор',
      description: null,
      isSystem: false,
      permissions: [{ permission: Permission.DIRECTORY_READ }],
      _count: { users: 0, departments: 0 },
      ...overrides,
    },
    preview: [],
  };
}

const admin = { id: 'admin-1', email: 'a@b.by', displayName: 'Админ', permissions: [] as string[] };
const actorWith = (...permissions: Permission[]) => ({ ...admin, permissions });

describe('RolesService (#379)', () => {
  const roles = {
    findAll: vi.fn(),
    findById: vi.fn(),
    lockForUpdate: vi.fn(),
    codeExists: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addPermission: vi.fn(),
    removePermission: vi.fn(),
  };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };
  const signedUrls = { fileContentUrl: (id: string) => `/api/v1/files/${id}/content` };
  const audience = { roleUserIds: vi.fn() };

  let service: RolesService;

  beforeEach(() => {
    vi.clearAllMocks();
    roles.lockForUpdate.mockResolvedValue(true);
    audience.roleUserIds.mockResolvedValue([]);
    service = new RolesService(
      roles as never,
      tx as never,
      eventBus as never,
      signedUrls as never,
      audience as never,
    );
  });

  describe('setPermission', () => {
    it('выдача: замок → запись → событие с payload', async () => {
      roles.findById.mockResolvedValueOnce(record()).mockResolvedValueOnce(
        record({
          permissions: [
            { permission: Permission.DIRECTORY_READ },
            { permission: Permission.WORKFLOW_MANAGE },
          ],
        }),
      );
      roles.addPermission.mockResolvedValue(true);

      const role = await service.setPermission(
        'role-1',
        Permission.WORKFLOW_MANAGE,
        true,
        actorWith(Permission.WORKFLOW_MANAGE),
      );

      expect(roles.lockForUpdate).toHaveBeenCalledWith('role-1', 'tx-handle');
      expect(roles.addPermission).toHaveBeenCalledWith(
        'role-1',
        Permission.WORKFLOW_MANAGE,
        'tx-handle',
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.role.permissions_changed',
        { roleId: 'role-1', permission: Permission.WORKFLOW_MANAGE, granted: true },
        expect.objectContaining({ actorId: 'admin-1', aggregateId: 'role-1' }),
      );
      expect(role.permissions).toContain(Permission.WORKFLOW_MANAGE);
    });

    it('выдача права без реального изменения — токены не трогаем', async () => {
      roles.findById.mockResolvedValue(record());
      roles.addPermission.mockResolvedValue(false);

      await service.setPermission(
        'role-1',
        Permission.DIRECTORY_READ,
        true,
        actorWith(Permission.DIRECTORY_READ),
      );

      expect(audience.roleUserIds).not.toHaveBeenCalled();
    });

    it('повторная выдача идемпотентна: события нет', async () => {
      roles.findById.mockResolvedValue(record());
      roles.addPermission.mockResolvedValue(false);

      await service.setPermission(
        'role-1',
        Permission.DIRECTORY_READ,
        true,
        actorWith(Permission.DIRECTORY_READ),
      );

      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('отзыв: событие granted: false, чужое право отзывать можно', async () => {
      roles.findById.mockResolvedValue(record());
      roles.removePermission.mockResolvedValue(true);

      await service.setPermission('role-1', Permission.TASK_CREATE, false, actorWith());

      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.role.permissions_changed',
        { roleId: 'role-1', permission: Permission.TASK_CREATE, granted: false },
        expect.anything(),
      );
    });

    it('нет роли → 404 (замок не нашёл строку)', async () => {
      roles.lockForUpdate.mockResolvedValue(false);

      await expect(
        service.setPermission(
          'role-1',
          Permission.TASK_CREATE,
          true,
          actorWith(Permission.TASK_CREATE),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(roles.addPermission).not.toHaveBeenCalled();
    });

    it('«Администратор»: выдача и отзыв → 409 ROLE_LOCKED', async () => {
      roles.findById.mockResolvedValue(record({ code: 'admin' }));

      for (const granted of [true, false]) {
        await expect(
          service.setPermission(
            'role-1',
            Permission.TASK_CREATE,
            granted,
            actorWith(Permission.TASK_CREATE),
          ),
        ).rejects.toMatchObject({ code: ErrorCode.ROLE_LOCKED });
      }
      expect(roles.addPermission).not.toHaveBeenCalled();
      expect(roles.removePermission).not.toHaveBeenCalled();
    });

    it('чужое право выдать нельзя → 403 ROLE_PERMISSION_NOT_HELD', async () => {
      roles.findById.mockResolvedValue(record());

      await expect(
        service.setPermission(
          'role-1',
          Permission.CORE_ADMIN,
          true,
          actorWith(Permission.ROLE_MANAGE),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ROLE_PERMISSION_NOT_HELD,
        details: { permissions: [Permission.CORE_ADMIN] },
      });
    });
  });

  describe('updateRole', () => {
    it('права «Администратора» → 409, имя менять можно', async () => {
      roles.findById.mockResolvedValue(record({ code: 'admin' }));

      await expect(
        service.updateRole('role-1', { permissions: [] }, actorWith(Permission.ROLE_MANAGE)),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_LOCKED });

      await service.updateRole('role-1', { name: 'Главный' }, actorWith(Permission.ROLE_MANAGE));
      expect(roles.update).toHaveBeenCalledWith('role-1', { name: 'Главный' }, 'tx-handle');
    });

    it('события по разнице, без role.updated', async () => {
      roles.findById.mockResolvedValue(
        record({
          permissions: [
            { permission: Permission.DIRECTORY_READ },
            { permission: Permission.TASK_CREATE },
          ],
        }),
      );

      await service.updateRole(
        'role-1',
        { permissions: [Permission.DIRECTORY_READ, Permission.WORKFLOW_MANAGE] },
        actorWith(Permission.WORKFLOW_MANAGE),
      );

      const events = eventBus.emit.mock.calls.map((call) => call[2]);
      expect(events).toContainEqual({
        roleId: 'role-1',
        permission: Permission.WORKFLOW_MANAGE,
        granted: true,
      });
      expect(events).toContainEqual({
        roleId: 'role-1',
        permission: Permission.TASK_CREATE,
        granted: false,
      });
      expect(eventBus.emit.mock.calls.some((call) => call[1] === 'directory.role.updated')).toBe(
        false,
      );
    });

    it('смена набора прав отзывает токены всех участников роли', async () => {
      roles.findById.mockResolvedValue(
        record({ permissions: [{ permission: Permission.DIRECTORY_READ }] }),
      );
      audience.roleUserIds.mockResolvedValue(['u1', 'u2']);

      await service.updateRole(
        'role-1',
        { permissions: [Permission.DIRECTORY_READ, Permission.WORKFLOW_MANAGE] },
        actorWith(Permission.WORKFLOW_MANAGE),
      );

      expect(audience.roleUserIds).toHaveBeenCalledWith('role-1', 'tx-handle');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.role.access_changed',
        { roleId: 'role-1', reason: 'permissions', userIds: ['u1', 'u2'] },
        expect.objectContaining({ actorId: 'admin-1', aggregateId: 'role-1' }),
      );
    });

    it('эскалация при добавлении права → 403, записи нет', async () => {
      roles.findById.mockResolvedValue(record());

      await expect(
        service.updateRole(
          'role-1',
          { permissions: [Permission.DIRECTORY_READ, Permission.CORE_ADMIN] },
          actorWith(Permission.ROLE_MANAGE),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_PERMISSION_NOT_HELD });
      expect(roles.update).not.toHaveBeenCalled();
    });

    it('role.updated несёт только имя и описание', async () => {
      roles.findById.mockResolvedValue(record());

      await service.updateRole('role-1', { description: 'Новое' }, actorWith());

      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.role.updated',
        { roleId: 'role-1', changedFields: ['description'] },
        expect.anything(),
      );
    });
  });

  describe('createRole', () => {
    it('эскалация → 403', async () => {
      await expect(
        service.createRole(
          { name: 'Новая', description: null, permissions: [Permission.CORE_ADMIN] },
          actorWith(Permission.ROLE_MANAGE),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_PERMISSION_NOT_HELD });
      expect(roles.create).not.toHaveBeenCalled();
    });

    it('дубли прав удаляются, код выдаётся сервером', async () => {
      roles.codeExists.mockResolvedValue(false);
      roles.create.mockResolvedValue('role-9');
      roles.findById.mockResolvedValue(record({ id: 'role-9' }));

      await service.createRole(
        {
          name: 'Новая',
          description: null,
          permissions: [Permission.TASK_CREATE, Permission.TASK_CREATE],
        },
        actorWith(Permission.TASK_CREATE),
      );

      expect(roles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: expect.stringMatching(/^role-[0-9a-f]{8}$/),
          permissions: [Permission.TASK_CREATE],
        }),
        'tx-handle',
      );
    });
  });

  describe('deleteRole', () => {
    it('системная роль → CONFLICT', async () => {
      roles.findById.mockResolvedValue(record({ isSystem: true }));

      await expect(service.deleteRole('role-1', 'admin-1')).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
      });
      expect(roles.delete).not.toHaveBeenCalled();
    });

    it('пользовательская роль с составом удаляется — назначения снимает каскад', async () => {
      roles.findById.mockResolvedValue(record({ _count: { users: 3, departments: 1 } }));

      await service.deleteRole('role-1', 'admin-1');

      expect(roles.delete).toHaveBeenCalledWith('role-1', 'tx-handle');
    });

    it('свободная несистемная → удаляет + событие в той же транзакции', async () => {
      roles.findById.mockResolvedValue(record());

      await service.deleteRole('role-1', 'admin-1');

      expect(roles.delete).toHaveBeenCalledWith('role-1', 'tx-handle');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.role.deleted',
        { roleId: 'role-1', code: 'editor', memberCount: 0, departmentCount: 0 },
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });

    it('состав вычисляется ДО удаления и отзывается после role.deleted (#866)', async () => {
      roles.findById.mockResolvedValue(record({ _count: { users: 2, departments: 0 } }));
      audience.roleUserIds.mockResolvedValue(['u-1', 'u-2']);

      await service.deleteRole('role-1', 'admin-1');

      // Аудитория считается до каскада: после удаления роли состав пуст.
      expect(audience.roleUserIds).toHaveBeenCalledWith('role-1', 'tx-handle');
      expect(audience.roleUserIds.mock.invocationCallOrder[0]).toBeLessThan(
        roles.delete.mock.invocationCallOrder[0]!,
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.role.access_changed',
        { roleId: 'role-1', reason: 'membership', userIds: ['u-1', 'u-2'] },
        expect.objectContaining({
          actorId: 'admin-1',
          aggregateType: 'role',
          aggregateId: 'role-1',
        }),
      );
    });

    it('роль без действующих участников — только role.deleted', async () => {
      roles.findById.mockResolvedValue(record());

      await service.deleteRole('role-1', 'admin-1');

      expect(eventBus.emit).not.toHaveBeenCalledWith(
        'tx-handle',
        'directory.role.access_changed',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('права вне каталога отфильтровываются из ответа', async () => {
    roles.findAll.mockResolvedValue([
      record({
        permissions: [{ permission: 'legacy.permission' }, { permission: Permission.TASK_CREATE }],
      }),
    ]);

    const [role] = await service.listRoles();
    expect(role?.permissions).toEqual([Permission.TASK_CREATE]);
  });
});
