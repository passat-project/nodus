import { describe, expect, it } from 'vitest';
import type { Department, UserListItem } from '@nodus/contracts';

import { buildDepartmentTree } from './departments.js';

/**
 * Дерево подразделений на моках (#723): `memberCount` — штат подразделения,
 * как `members: { where: { status: 'active' } }` на API; уволенный остаётся
 * в списке сотрудников подразделения, но в число не входит.
 */

const user = (id: string, departmentId: string, status: UserListItem['status']): UserListItem => ({
  id,
  displayName: id,
  status,
  avatarUrl: null,
  positionName: null,
  departmentName: null,
  email: `${id}@test.local`,
  managerId: null,
  departmentId,
  legalDepartmentId: null,
  positionId: null,
  legalPositionId: null,
});

const department: Department = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'BIM-отдел',
  kind: 'management',
  parentId: null,
  headId: null,
  deputyId: null,
  sortOrder: 0,
  isActive: true,
};

describe('buildDepartmentTree: memberCount (#723)', () => {
  it('считает только действующих, хотя уволенный остаётся в справочнике', () => {
    const users = [
      user('a', department.id, 'active'),
      user('b', department.id, 'active'),
      user('c', department.id, 'deactivated'),
    ];

    const [root] = buildDepartmentTree('management', users, [department]);

    expect(root?.memberCount).toBe(2);
  });

  it('подразделение без действующих — ноль', () => {
    const users = [user('c', department.id, 'deactivated')];

    const [root] = buildDepartmentTree('management', users, [department]);

    expect(root?.memberCount).toBe(0);
  });
});
