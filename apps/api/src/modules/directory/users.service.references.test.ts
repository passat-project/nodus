import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser, type CreateUserDto } from '@nodus/contracts';

import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { UsersService } from './users.service.js';

/** Валидация ссылок оргструктуры (#441): вынесено из users.service.test.ts
 *  (лимит 300 строк) — проверки подразделений и должностей. Руководитель с
 *  #923 — производное поле (ручное значение не принимается), циклы живут в
 *  SQL-пересчёте `ManagerDerivationRepository`. */

const CREATE_DTO: CreateUserDto = {
  email: 'new@nodus.by',
  password: 'Start!23456789',
  lastName: 'Новый',
  firstName: 'Сотрудник',
  middleName: null,
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
    setRoles: vi.fn(),
    findRef: vi.fn(),
    findDepartmentId: vi.fn(),
  };
  const roles = { countByIds: vi.fn() };
  const departments = { findRef: vi.fn() };
  const departmentsRepo = {
    findParentChain: vi.fn(),
    findNamesByIds: vi.fn(),
    clearHeadAndDeputy: vi.fn(),
    lockTree: vi.fn(),
    lockForUpdate: vi.fn(),
  };
  const managers = { recomputeUsers: vi.fn(), recomputeDepartments: vi.fn() };
  const positions = { findRef: vi.fn(), lockMany: vi.fn() };
  const membership = { effectiveRoleIds: vi.fn() };
  const passwords = { hash: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };

  let service: UsersService;

  beforeEach(() => {
    vi.resetAllMocks();
    membership.effectiveRoleIds.mockResolvedValue([]);
    users.findDepartmentId.mockResolvedValue(null);
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

  it('createUser: несуществующее подразделение → 400 not_found', async () => {
    users.emailExists.mockResolvedValue(false);
    roles.countByIds.mockResolvedValue(1);
    departments.findRef.mockResolvedValue(null);

    await expect(
      service.createUser({ ...CREATE_DTO, departmentId: 'ghost' }, actor()),
    ).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_REFERENCE_INVALID,
      details: { field: 'departmentId', reason: 'not_found' },
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

  it('updateUser: назначение лочит строки должностей до проверки (гонка с удалением)', async () => {
    users.findCardById.mockResolvedValue(cardRow());
    positions.findRef.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        kind: id === 'pos-1' ? 'management' : 'legal',
      }),
    );

    await service.updateUser('user-1', { positionId: 'pos-1', legalPositionId: 'pos-2' }, actor());

    // Порядок захватов — по id внутри lockMany; обе должности под замком.
    expect(positions.lockMany).toHaveBeenCalledWith(['pos-1', 'pos-2'], 'tx-handle');
  });

  it('updateUser: очистка ссылок (null) проходит без проверок', async () => {
    users.findCardById.mockResolvedValue(cardRow());

    await service.updateUser('user-1', { departmentId: null, positionId: null }, actor());

    expect(departments.findRef).not.toHaveBeenCalled();
    expect(positions.findRef).not.toHaveBeenCalled();
    expect(users.update).toHaveBeenCalled();
  });

  it('createUser: руководитель производный — пересчёт в той же транзакции', async () => {
    users.emailExists.mockResolvedValue(false);
    roles.countByIds.mockResolvedValue(1);
    users.create.mockResolvedValue(cardRow());
    users.findCardById.mockResolvedValue(cardRow());

    await service.createUser(CREATE_DTO, actor());

    expect(users.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ managerId: expect.anything() }),
      'tx-handle',
    );
    expect(managers.recomputeUsers).toHaveBeenCalledWith(['user-1'], 'tx-handle');
  });
});
