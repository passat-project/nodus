import { describe, expect, it } from 'vitest';
import type { Department, UserListItem } from '@nodus/contracts';

import { buildDepartmentTree, clearLeadershipSeats } from './departments.js';

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
  deputyIds: [],
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

/** #1032: перевод сотрудника в другой узел снимает его руководящие места —
 *  мок повторяет users-transfer.ts (#946), сервер держит «одно место». */
const seat = (id: string, headId: string | null, deputyIds: string[]): Department =>
  ({
    id,
    name: id,
    kind: 'management',
    parentId: null,
    headId,
    deputyIds,
    sortOrder: 0,
    isActive: true,
  }) as never;

describe('clearLeadershipSeats (#1032)', () => {
  it('перевод снимает главу и зама старого узла и чужой зам-слот', () => {
    const seats = [
      seat('old', 'user-1', ['user-2']),
      seat('new', null, []),
      seat('far', null, ['user-1']),
    ];
    const next = clearLeadershipSeats(seats, 'user-1', 'new');
    expect(next[0]!.headId).toBeNull();
    expect(next[0]!.deputyIds).toEqual(['user-2']);
    expect(next[2]!.deputyIds).toEqual([]);
  });

  it('целевой узел сохраняет место (сотрудник уже там глава)', () => {
    const source = [seat('old', null, []), seat('new', 'user-1', [])];
    const next = clearLeadershipSeats(source, 'user-1', 'new');
    expect(next[1]!.headId).toBe('user-1');
  });

  it('нет руководящих мест — массив не меняется по ссылкам', () => {
    const source = [seat('a', 'other', [])];
    const next = clearLeadershipSeats(source, 'user-1', 'new');
    expect(next[0]).toBe(source[0]);
  });

  it('регистр UUID не мешает сравнению', () => {
    const source = [seat('OLD', 'USER-1', ['USER-1'])];
    const next = clearLeadershipSeats(source, 'user-1', null);
    expect(next[0]!.headId).toBeNull();
    expect(next[0]!.deputyIds).toEqual([]);
  });
});
