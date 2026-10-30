import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser, type CreateUserDto } from '@nodus/contracts';

import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { UsersService } from './users.service.js';

/** Валидация ссылок оргструктуры (#441): вынесено из users.service.test.ts
 *  (лимит 300 строк) — проверки руководителя, подразделений и должностей. */

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

describe('UsersService: ссылки оргструктуры (#441)', () => {
  const users = {
    findCardById: vi.fn(),
    emailExists: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findRef: vi.fn(),
  };
  const roles = { countByIds: vi.fn() };
  const departments = { findRef: vi.fn() };
  const positions = { findRef: vi.fn() };
  const membership = { effectiveRoleIds: vi.fn() };
  const passwords = { hash: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: UsersService;

  beforeEach(() => {
    vi.resetAllMocks();
    membership.effectiveRoleIds.mockResolvedValue([]);
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
      { process: vi.fn() } as never,
    );
  });

  it('createUser: ссылка на несуществующего руководителя → 400 not_found', async () => {
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

  it('createUser: подразделение чужого вида структуры → 400 kind_mismatch', async () => {
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

  it('updateUser: руководитель — сам сотрудник → 400 self', async () => {
    users.findCardById.mockResolvedValue(cardRow());

    await expect(
      service.updateUser('user-1', { managerId: 'user-1' }, actor()),
    ).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
      details: { field: 'managerId', reason: 'self' },
    });
    expect(users.update).not.toHaveBeenCalled();
  });

  it('updateUser: неактивная должность → 400 inactive', async () => {
    users.findCardById.mockResolvedValue(cardRow());
    positions.findRef.mockResolvedValue({ id: 'pos-1', kind: 'management', isActive: false });

    await expect(
      service.updateUser('user-1', { positionId: 'pos-1' }, actor()),
    ).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
      details: { field: 'positionId', reason: 'inactive' },
    });
  });

  it('updateUser: очистка ссылок (null) проходит без проверок', async () => {
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
