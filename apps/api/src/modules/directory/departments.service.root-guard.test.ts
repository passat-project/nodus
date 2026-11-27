import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser } from '@nodus/contracts';

import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { DepartmentsService } from './departments.service.js';

/**
 * Правило корня (#982): корень управленческой структуры один — главная карточка
 * компании. Обычный узел меняет родителя, но не теряет его; открепление
 * отклоняется на раннем быстром пути (до лока дерева) и повторно — на
 * состоянии после advisory-лока. Парный кейс — юридическая структура (лес
 * корней) — в `departments.service.test.ts`, «перенос в корень снимает роли».
 */
const actor: AuthUser = {
  id: 'admin-1',
  email: 'a@b.by',
  displayName: 'Админ',
  permissions: [],
};

const stub = () => vi.fn();

describe('DepartmentsService: корень управленческой структуры (#982)', () => {
  it('управленческое подразделение нельзя открепить в корень — 409, без локов и мутаций', async () => {
    const departments = {
      findById: vi.fn().mockResolvedValue({
        id: 'dep',
        name: 'Отдел',
        kind: 'management',
        parentId: 'root',
        headId: null,
        deputyId: null,
        sortOrder: 0,
        isActive: true,
        head: null,
        deputy: null,
        _count: { members: 0, legalMembers: 0 },
      }),
      lockTree: stub(),
      lockForUpdate: stub(),
      update: stub(),
      findParentChain: stub(),
    };
    const service = new DepartmentsService(
      departments as never,
      { findRef: stub() } as never,
      new RoleAssignmentGuard(
        { permissionsByIds: stub() } as never,
        { effectiveRoleIds: stub() } as never,
      ),
      new ReferenceGuard(stub() as never, stub() as never, stub() as never),
      { run: (cb: (t: string) => unknown) => cb('tx-handle') } as never,
      { emit: stub() } as never,
      { roleIdsOfDepartments: stub() } as never,
      { recomputeUsers: stub(), recomputeDepartments: stub() } as never,
    );

    await expect(service.update('dep', { parentId: null }, actor)).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
      details: { id: 'dep' },
    });
    expect(departments.lockTree).not.toHaveBeenCalled();
    expect(departments.update).not.toHaveBeenCalled();
  });

  it('повторная проверка после лока ловит гонку: узел переставили между чтением и локом', async () => {
    const departments = {
      findById: vi
        .fn()
        // Ранняя проверка: узел ещё корень — быстрый путь проходит.
        .mockResolvedValueOnce({
          id: 'dep',
          name: 'Отдел',
          kind: 'management',
          parentId: null,
          headId: null,
          deputyId: null,
          sortOrder: 0,
          isActive: true,
          head: null,
          deputy: null,
          _count: { members: 0, legalMembers: 0 },
        })
        // После advisory-лока: конкурент уже перенёс узел под родителя.
        .mockResolvedValueOnce({
          id: 'dep',
          name: 'Отдел',
          kind: 'management',
          parentId: 'root',
          headId: null,
          deputyId: null,
          sortOrder: 0,
          isActive: true,
          head: null,
          deputy: null,
          _count: { members: 0, legalMembers: 0 },
        }),
      lockTree: stub(),
      lockForUpdate: stub(),
      update: stub(),
      findParentChain: stub(),
    };
    const service = new DepartmentsService(
      departments as never,
      { findRef: stub() } as never,
      new RoleAssignmentGuard(
        { permissionsByIds: stub() } as never,
        { effectiveRoleIds: stub() } as never,
      ),
      new ReferenceGuard(stub() as never, stub() as never, stub() as never),
      { run: (cb: (t: string) => unknown) => cb('tx-handle') } as never,
      { emit: stub() } as never,
      { roleIdsOfDepartments: stub() } as never,
      { recomputeUsers: stub(), recomputeDepartments: stub() } as never,
    );

    await expect(service.update('dep', { parentId: null }, actor)).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
    });
    expect(departments.update).not.toHaveBeenCalled();
  });

  it('второй management-корень через POST отклоняется (#1028)', async () => {
    const departments = {
      countRoots: vi.fn().mockResolvedValue(1),
      lockTree: stub(),
      create: stub(),
    };
    const service = new DepartmentsService(
      departments as never,
      { findRef: stub() } as never,
      new RoleAssignmentGuard(
        { permissionsByIds: stub() } as never,
        { effectiveRoleIds: stub() } as never,
      ),
      new ReferenceGuard(stub() as never, stub() as never, stub() as never),
      { run: (cb: (t: string) => unknown) => cb('tx-handle') } as never,
      { emit: stub() } as never,
      { roleIdsOfDepartments: stub() } as never,
      { recomputeUsers: stub(), recomputeDepartments: stub() } as never,
    );

    await expect(
      service.create(
        {
          name: 'Второй корень',
          kind: 'management',
          parentId: null,
          headId: null,
          deputyIds: [],
          sortOrder: 0,
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
      details: { reason: 'second_root' },
    });
    expect(departments.create).not.toHaveBeenCalled();
  });

  it('первый management-корень создаётся (проверка не блокирует пустую структуру)', async () => {
    const departments = {
      countRoots: vi.fn().mockResolvedValue(0),
      lockTree: stub(),
      create: vi.fn().mockResolvedValue({
        id: 'root',
        name: 'Компания',
        kind: 'management',
        parentId: null,
        headId: null,
        sortOrder: 0,
        isActive: true,
        head: null,
        deputies: [],
        _count: { members: 0, legalMembers: 0 },
      }),
    };
    const service = new DepartmentsService(
      departments as never,
      { findRef: stub() } as never,
      new RoleAssignmentGuard(
        { permissionsByIds: stub() } as never,
        { effectiveRoleIds: stub() } as never,
      ),
      new ReferenceGuard(stub() as never, stub() as never, stub() as never),
      { run: (cb: (t: string) => unknown) => cb('tx-handle') } as never,
      { emit: stub() } as never,
      { roleIdsOfDepartments: stub() } as never,
      { recomputeUsers: stub(), recomputeDepartments: stub() } as never,
    );

    await expect(
      service.create(
        {
          name: 'Компания',
          kind: 'management',
          parentId: null,
          headId: null,
          deputyIds: [],
          sortOrder: 0,
        },
        actor,
      ),
    ).resolves.toMatchObject({ id: 'root' });
  });
});
