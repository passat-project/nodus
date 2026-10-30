import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, Permission, type AuthUser } from '@nodus/contracts';

import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { DepartmentsService } from './departments.service.js';

const actor = (permissions: string[] = []): AuthUser => ({
  id: 'admin-1',
  email: 'a@b.by',
  displayName: 'Админ',
  permissions,
});

function row(
  id: string,
  parentId: string | null,
  name = id,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    kind: 'management',
    parentId,
    headId: null,
    deputyId: null,
    sortOrder: 0,
    isActive: true,
    head: null,
    deputy: null,
    _count: { members: 0 },
    ...overrides,
  };
}

describe('DepartmentsService', () => {
  const departments = {
    findAllByKind: vi.fn(),
    findById: vi.fn(),
    lockForUpdate: vi.fn(),
    lockTree: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findParentChain: vi.fn(),
    findSubtreeIds: vi.fn(),
  };
  const users = { findActiveIdsByDepartmentIds: vi.fn() };
  const roles = { permissionsByIds: vi.fn(), lockForUpdate: vi.fn(), lockByCodeForUpdate: vi.fn() };
  const membership = { effectiveRoleIds: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: DepartmentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    membership.effectiveRoleIds.mockResolvedValue([]);
    departments.lockForUpdate.mockResolvedValue(true);
    const guard = new RoleAssignmentGuard(roles as never, membership as never);
    service = new DepartmentsService(
      departments as never,
      users as never,
      guard,
      tx as never,
      eventBus as never,
    );
  });

  describe('getTree', () => {
    it('собирает иерархию из плоского списка с memberCount', async () => {
      departments.findAllByKind.mockResolvedValue([
        row('root', null, 'ПассатПроект', { _count: { members: 5 } }),
        row('child-1', 'root', 'Проектное'),
        row('child-2', 'root', 'Бухгалтерия'),
        row('grand', 'child-1', 'BIM-группа'),
      ]);

      const tree = await service.getTree('management');

      expect(tree).toHaveLength(1);
      expect(tree[0]!.name).toBe('ПассатПроект');
      expect(tree[0]!.memberCount).toBe(5);
      expect(tree[0]!.children.map((c) => c.name)).toEqual(['Проектное', 'Бухгалтерия']);
      expect(tree[0]!.children[0]!.children[0]!.name).toBe('BIM-группа');
    });
  });

  describe('update', () => {
    it('цикл в дереве (родитель — собственный потомок) → CONFLICT', async () => {
      departments.findById.mockResolvedValue(row('dep', null));
      departments.findParentChain.mockResolvedValue(['parent', 'dep']); // dep — предок parent

      await expect(service.update('dep', { parentId: 'parent' }, actor())).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
      });
      // #544: проверка цепи — под advisory-локом дерева, в транзакции.
      expect(departments.lockTree).toHaveBeenCalledWith('tx-handle');
      expect(departments.findParentChain).toHaveBeenCalledWith('parent', 'tx-handle');
      expect(departments.update).not.toHaveBeenCalled();
    });

    it('родитель не найден → 404, мутации нет', async () => {
      departments.findById.mockImplementation(async (foundId: string) =>
        foundId === 'dep' ? row('dep', null) : null,
      );

      await expect(service.update('dep', { parentId: 'missing' }, actor())).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
      expect(departments.update).not.toHaveBeenCalled();
    });

    it('переименование пишет только присланное поле: родитель, руководитель, зам, вид и порядок не трогаются (#492)', async () => {
      departments.findById.mockResolvedValue(
        row('dep', 'parent', 'Старое имя', {
          kind: 'legal',
          headId: 'head-1',
          deputyId: 'deputy-1',
          sortOrder: 5,
        }),
      );
      departments.update.mockResolvedValue(
        row('dep', 'parent', 'Новое имя', {
          kind: 'legal',
          headId: 'head-1',
          deputyId: 'deputy-1',
          sortOrder: 5,
        }),
      );

      const node = await service.update('dep', { name: 'Новое имя' }, actor());

      // В репозиторий уходит ровно присланное — без подставленных дефолтов.
      expect(departments.update).toHaveBeenCalledWith('dep', { name: 'Новое имя' }, 'tx-handle');
      // Переименование не меняет структуру — дерево не лочится и цепь не читается.
      expect(departments.lockTree).not.toHaveBeenCalled();
      expect(departments.findParentChain).not.toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.department.updated',
        { departmentId: 'dep', changedFields: ['name'] },
        expect.objectContaining({ actorId: 'admin-1' }),
      );
      expect(node).toMatchObject({
        parentId: 'parent',
        kind: 'legal',
        headId: 'head-1',
        deputyId: 'deputy-1',
        sortOrder: 5,
        name: 'Новое имя',
      });
    });

    it('валидная смена родителя → update + событие в транзакции', async () => {
      departments.findById.mockResolvedValue(row('dep', null));
      departments.findParentChain.mockResolvedValue(['new-parent']);
      departments.findSubtreeIds.mockResolvedValue(['dep']);
      users.findActiveIdsByDepartmentIds.mockResolvedValue([]); // поддерево без сотрудников
      departments.update.mockResolvedValue(row('dep', 'new-parent'));

      const node = await service.update('dep', { parentId: 'new-parent' }, actor());

      expect(departments.update).toHaveBeenCalledWith(
        'dep',
        { parentId: 'new-parent' },
        'tx-handle',
      );
      expect(departments.lockTree).toHaveBeenCalledWith('tx-handle');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.department.updated',
        expect.objectContaining({ departmentId: 'dep' }),
        expect.objectContaining({ actorId: 'admin-1' }),
      );
      expect(node.parentId).toBe('new-parent');
    });

    it('правка без смены родителя — bind-проверка не запускается', async () => {
      departments.findById.mockResolvedValue(row('dep', 'root'));
      departments.update.mockResolvedValue(row('dep', 'root'));

      await service.update('dep', { name: 'Новое имя' }, actor());

      expect(departments.findSubtreeIds).not.toHaveBeenCalled();
      expect(membership.effectiveRoleIds).not.toHaveBeenCalled();
    });

    it('bind (#490): перенос выдаёт сотруднику роль сверх прав актора → 403', async () => {
      departments.findById.mockResolvedValue(row('dep', null));
      departments.findParentChain.mockResolvedValue(['new-parent']);
      departments.findSubtreeIds.mockResolvedValue(['dep', 'child']);
      users.findActiveIdsByDepartmentIds.mockResolvedValue(['u-1', 'u-2']);
      // Снимок «до» (u-1, u-2) — без ролей; «после» переноса u-1 получает роль.
      membership.effectiveRoleIds
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['role-dept'])
        .mockResolvedValueOnce([]);
      roles.permissionsByIds.mockResolvedValue(new Map([['role-dept', [Permission.CRM_MANAGE]]]));

      await expect(
        service.update('dep', { parentId: 'new-parent' }, actor()),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_PERMISSION_NOT_HELD });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('bind (#490): перенос, добавляющий роль из прав актора — разрешён', async () => {
      departments.findById.mockResolvedValue(row('dep', null));
      departments.findParentChain.mockResolvedValue(['new-parent']);
      departments.findSubtreeIds.mockResolvedValue(['dep']);
      users.findActiveIdsByDepartmentIds.mockResolvedValue(['u-1']);
      membership.effectiveRoleIds
        .mockResolvedValueOnce([]) // до: снимок
        .mockResolvedValueOnce(['role-dept']); // после: перенос добавил
      roles.permissionsByIds.mockResolvedValue(new Map([['role-dept', [Permission.CRM_MANAGE]]]));
      departments.update.mockResolvedValue(row('dep', 'new-parent'));

      await service.update('dep', { parentId: 'new-parent' }, actor([Permission.CRM_MANAGE]));

      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('перенос в корень снимает роли — правами не ограничен', async () => {
      departments.findById.mockResolvedValue(row('dep', 'root'));
      departments.findSubtreeIds.mockResolvedValue(['dep']);
      users.findActiveIdsByDepartmentIds.mockResolvedValue(['u-1']);
      membership.effectiveRoleIds.mockResolvedValueOnce(['role-dept']).mockResolvedValueOnce([]);
      departments.update.mockResolvedValue(row('dep', null));

      await service.update('dep', { parentId: null }, actor());

      expect(departments.lockTree).toHaveBeenCalledWith('tx-handle');
      expect(departments.findParentChain).not.toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalled();
      expect(roles.permissionsByIds).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('архивирует (isActive=false) + событие archived', async () => {
      departments.findById.mockResolvedValue(row('dep', null));

      await service.archive('dep', 'admin-1');

      expect(departments.update).toHaveBeenCalledWith('dep', { isActive: false }, 'tx-handle');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tx-handle',
        'directory.department.archived',
        { departmentId: 'dep' },
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });
  });
});
