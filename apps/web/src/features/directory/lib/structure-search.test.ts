import { describe, expect, it } from 'vitest';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';

import {
  activeDepartmentIds,
  mainDepartmentId,
  searchStructure,
  structureDepartmentOf,
} from './structure-search.js';

const node = (id: string, name: string, children: DepartmentNode[] = []): DepartmentNode => ({
  id,
  name,
  kind: 'management',
  parentId: null,
  headId: null,
  deputyIds: [],
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputies: [],
  memberCount: 0,
  children,
});

const tree = (): DepartmentNode[] => [
  node('main', 'Компания', [node('bim', 'BIM-отдел')]),
  node('hr', 'Кадры'),
];

const person = (
  id: string,
  status: UserListItem['status'],
  overrides: Partial<UserListItem> = {},
): UserListItem => ({
  id,
  displayName: id,
  status,
  avatarUrl: null,
  positionName: null,
  departmentName: null,
  email: `${id}@test.local`,
  managerId: null,
  departmentId: null,
  legalDepartmentId: null,
  positionId: null,
  legalPositionId: null,
  ...overrides,
});

describe('структура: главная карточка и поиск (#768)', () => {
  it('главная — первый корень; сотрудник без активного подразделения — в главной', () => {
    expect(mainDepartmentId(tree())).toBe('main');
    expect(mainDepartmentId([])).toBeNull();
    const active = activeDepartmentIds(tree());
    expect(
      structureDepartmentOf(person('a', 'active', { departmentId: 'bim' }), active, 'main'),
    ).toBe('bim');
    expect(
      structureDepartmentOf(person('b', 'active', { departmentId: null }), active, 'main'),
    ).toBe('main');
    expect(
      structureDepartmentOf(person('c', 'active', { departmentId: 'archived' }), active, 'main'),
    ).toBe('main');
    expect(structureDepartmentOf(person('d', 'active'), new Set(), null)).toBeNull();
  });

  it('ищет подразделения и активных сотрудников по ФИО/должности; дерево не фильтруется', () => {
    const users = [
      person('Иванов Иван', 'active', { positionName: 'ГИП' }),
      person('Петров Пётр', 'deactivated', { positionName: 'ГИП' }),
      person('Сидоров', 'active', { positionName: 'Инженер' }),
    ];
    const found = searchStructure(tree(), users, 'гип');
    expect(found.departments).toEqual([]);
    expect(found.employees.map((user) => user.displayName)).toEqual(['Иванов Иван']);

    const departments = searchStructure(tree(), users, 'bim');
    expect(departments.departments.map((item) => item.id)).toEqual(['bim']);
    // Корни дерева целиком — фильтрации ветвей нет.
    expect(departments.departments[0]?.id).toBe('bim');

    expect(searchStructure(tree(), users, '   ')).toEqual({ departments: [], employees: [] });
  });
});
