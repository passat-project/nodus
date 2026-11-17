import { describe, expect, it, vi } from 'vitest';

import { listUsersOf, myOrganizationOf, userCardOf } from './users-organization.js';
import type { OrganizationDeps } from './users-organization.js';

/**
 * Чтение справочника и оргструктуры (#919): список с фильтрами, «Кто я» с
 * руководителем из прямой связи или оргструктуры, путь подразделения от
 * корня и карточка. Права/видимость — на API; здесь — форма и порядок.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
const DEPARTMENT_ID = '33333333-3333-4333-8333-333333333333';
const ROOT_ID = '44444444-4444-4444-8444-444444444444';
const SUB_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-17T10:00:00.000Z');

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    displayName: 'Иванов Иван',
    status: 'active',
    avatarFileId: null,
    email: 'ivanov@nodus.by',
    managerId: MANAGER_ID,
    departmentId: DEPARTMENT_ID,
    legalDepartmentId: null,
    positionId: null,
    legalPositionId: null,
    position: { name: 'Главный инженер' },
    department: { name: 'Проектный отдел' },
    ...overrides,
  };
}

function cardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'ivanov@nodus.by',
    displayName: 'Иванов Иван',
    status: 'active',
    lastName: 'Иванов',
    firstName: 'Иван',
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
    workRate: 1,
    gender: null,
    birthDate: null,
    hiredAt: null,
    workdayStart: null,
    avatarFileId: null,
    roles: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const users = {
    findPage: vi.fn(async () => ({ items: [listRow()], nextCursor: 'next' })),
    findListById: vi.fn(async (id: string): Promise<Record<string, unknown> | null> =>
      id === MANAGER_ID
        ? listRow({ id: MANAGER_ID, displayName: 'Петров Пётр', managerId: null })
        : listRow(),
    ),
    findListByIds: vi.fn(async () => [listRow({ id: SUB_ID, displayName: 'Сидоров Сидор' })]),
    findCardById: vi.fn(async (): Promise<Record<string, unknown> | null> => cardRow()),
    ...(overrides.users as object),
  };
  const org = {
    managerChainOf: vi.fn(async () => [] as string[]),
    subordinateIds: vi.fn(async () => [SUB_ID]),
    ...(overrides.org as object),
  };
  const departments = {
    findParentChain: vi.fn(async () => [DEPARTMENT_ID, ROOT_ID]),
    findNamesByIds: vi.fn(async () => [
      { id: DEPARTMENT_ID, name: 'Проектный отдел' },
      { id: ROOT_ID, name: 'Компания' },
    ]),
    ...(overrides.departments as object),
  };
  const deps: OrganizationDeps = {
    users: users as never,
    org: org as never,
    departments: departments as never,
    avatarUrlOf: () => null,
  };
  return { deps, users, org, departments };
}

describe('listUsersOf: страница справочника', () => {
  it('передаёт фильтры и курсор, маппит строки', async () => {
    const { deps, users } = makeDeps();
    const page = await listUsersOf(
      { search: 'иван', departmentId: DEPARTMENT_ID, status: 'active', cursor: 'c1', limit: 20 },
      deps,
    );
    expect(users.findPage).toHaveBeenCalledWith(
      { search: 'иван', departmentId: DEPARTMENT_ID, status: 'active' },
      'c1',
      20,
    );
    expect(page.items[0]).toMatchObject({ id: USER_ID, positionName: 'Главный инженер' });
    expect(page.nextCursor).toBe('next');
  });
});

describe('myOrganizationOf: «Кто я» (#919)', () => {
  it('руководитель из прямой связи, путь от корня и подчинённые', async () => {
    const { deps, org } = makeDeps();
    const result = await myOrganizationOf(USER_ID, deps);
    expect(result.user).toMatchObject({ id: USER_ID, displayName: 'Иванов Иван' });
    expect(result.manager).toMatchObject({ id: MANAGER_ID });
    expect(result.department?.path.map((item) => item.name)).toEqual([
      'Компания',
      'Проектный отдел',
    ]);
    expect(result.department?.name).toBe('Проектный отдел');
    expect(result.subordinates).toHaveLength(1);
    expect(result.subordinatesTotal).toBe(1);
    expect(org.managerChainOf).not.toHaveBeenCalled();
  });

  it('без прямой связи руководитель — из оргструктуры; без отдела пути нет', async () => {
    const { deps, org } = makeDeps({
      users: {
        findListById: vi.fn(async (id: string) =>
          id === USER_ID
            ? listRow({ managerId: null, departmentId: null })
            : listRow({ id: MANAGER_ID, displayName: 'Петров Пётр', managerId: null }),
        ),
        findListByIds: vi.fn(async () => []),
      },
      org: {
        managerChainOf: vi.fn(async () => [MANAGER_ID]),
        subordinateIds: vi.fn(async () => []),
      },
    });
    const result = await myOrganizationOf(USER_ID, deps);
    expect(org.managerChainOf).toHaveBeenCalledWith(USER_ID);
    expect(result.manager).toMatchObject({ id: MANAGER_ID });
    expect(result.department).toBeNull();
    expect(result.subordinatesTotal).toBe(0);
  });

  it('нет сотрудника — 404', async () => {
    const { deps } = makeDeps({ users: { findListById: vi.fn(async () => null) } });
    await expect(myOrganizationOf(USER_ID, deps)).rejects.toMatchObject({
      code: expect.stringContaining('NOT_FOUND'),
    });
  });
});

describe('userCardOf: карточка сотрудника', () => {
  it('отдаёт карточку; отсутствующий — 404', async () => {
    const { deps, users } = makeDeps();
    await expect(userCardOf(USER_ID, deps)).resolves.toMatchObject({ id: USER_ID });
    users.findCardById.mockResolvedValueOnce(null);
    await expect(userCardOf(USER_ID, deps)).rejects.toMatchObject({
      code: expect.stringContaining('NOT_FOUND'),
    });
  });
});
