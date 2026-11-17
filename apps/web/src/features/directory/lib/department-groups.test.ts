import { describe, expect, it } from 'vitest';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';

import { structurePanelGroups } from './department-groups.js';

const DEPARTMENT_ID = 'dept-1';
const HEAD_ID = 'head-1';
const DEPUTY_ID = 'deputy-1';

const node: DepartmentNode = {
  id: DEPARTMENT_ID,
  name: 'BIM-отдел',
  kind: 'management',
  parentId: null,
  headId: HEAD_ID,
  deputyId: DEPUTY_ID,
  sortOrder: 0,
  isActive: true,
  headName: HEAD_ID,
  deputyName: DEPUTY_ID,
  memberCount: 0,
  children: [],
};

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

const users = [
  person(HEAD_ID, 'active', { departmentId: DEPARTMENT_ID }),
  person(DEPUTY_ID, 'active'),
  person('member', 'active', { departmentId: DEPARTMENT_ID, positionName: 'Инженер' }),
  person('dismissed', 'deactivated', { departmentId: DEPARTMENT_ID }),
  person('orphan', 'active'),
  person('archived', 'active', { departmentId: 'archived-dept' }),
];
const activeIds = new Set([DEPARTMENT_ID]);

describe('группы панели подразделения (#768)', () => {
  it('руководители и активные подчинённые без дублей; уволенные не входят', () => {
    const groups = structurePanelGroups(node, users, {
      mainCard: false,
      activeDepartmentIds: activeIds,
    });
    expect(groups.heads.map((user) => user.id)).toEqual([HEAD_ID, DEPUTY_ID]);
    expect(groups.subordinates.map((user) => user.id)).toEqual(['member']);
  });

  it('главная карточка добавляет без подразделения и с архивным', () => {
    const groups = structurePanelGroups(node, users, {
      mainCard: true,
      activeDepartmentIds: activeIds,
    });
    expect(groups.subordinates.map((user) => user.id)).toEqual(['member', 'orphan', 'archived']);
  });

  it('поиск фильтрует обе группы по ФИО и должности', () => {
    const groups = structurePanelGroups(node, users, {
      mainCard: true,
      activeDepartmentIds: activeIds,
      query: 'инженер',
    });
    expect(groups.heads).toEqual([]);
    expect(groups.subordinates.map((user) => user.id)).toEqual(['member']);
  });
});
