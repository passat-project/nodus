import { describe, expect, it } from 'vitest';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';

import {
  filterTreeByName,
  focusSubset,
  hiddenReportsCount,
  insertDepartment,
  patchDepartment,
  totalEmployees,
} from './department-tree.js';

function node(id: string, memberCount: number, children: DepartmentNode[] = []): DepartmentNode {
  return {
    id,
    name: `dept-${id}`,
    kind: 'management',
    parentId: null,
    headId: null,
    deputyId: null,
    sortOrder: 0,
    isActive: true,
    headName: null,
    deputyName: null,
    memberCount,
    children,
  };
}

function person(id: string, managerId: string | null): UserListItem {
  return {
    id,
    displayName: `person-${id}`,
    status: 'active',
    avatarUrl: null,
    positionName: null,
    departmentName: null,
    email: `${id}@passatproekt.by`,
    managerId,
    departmentId: null,
    legalDepartmentId: null,
    positionId: null,
    legalPositionId: null,
  };
}

const tree = (): DepartmentNode[] => [node('a', 2, [node('b', 3, [node('c', 5)]), node('d', 1)])];

describe('totalEmployees', () => {
  it('суммирует своих и все подподразделения', () => {
    const root = tree()[0];
    if (!root) throw new Error('нет корня');
    expect(totalEmployees(root)).toBe(11);
  });
});

describe('filterTreeByName', () => {
  it('пустой запрос не фильтрует', () => {
    expect(filterTreeByName(tree(), '  ')).toEqual(tree());
  });
  it('совпадение в глубине тянет ветку родителей, чужие ветки выпадают', () => {
    const filtered = filterTreeByName(tree(), 'dept-c');
    expect(filtered[0]?.children.map((child) => child.id)).toEqual(['b']);
    expect(filtered[0]?.children[0]?.children.map((child) => child.id)).toEqual(['c']);
  });
});

describe('insertDepartment / patchDepartment', () => {
  it('вставка в корень и в узел', () => {
    expect(insertDepartment(tree(), node('e', 0)).map((n) => n.id)).toEqual(['a', 'e']);
    const nested = insertDepartment(tree(), { ...node('f', 0), parentId: 'b' });
    expect(nested[0]?.children[0]?.children.map((child) => child.id)).toEqual(['c', 'f']);
  });
  it('патч меняет узел на глубине, остальное нетронуто', () => {
    const patched = patchDepartment(tree(), 'c', { name: 'Группа ГИПов' });
    expect(patched[0]?.children[0]?.children[0]?.name).toBe('Группа ГИПов');
    expect(patched[0]?.children[1]?.name).toBe('dept-d');
  });
});

describe('focusSubset (вид «Подчинённость»)', () => {
  // цепочка ceo → vp → lead → eng плюс второй подчинённый lead и чужой корень
  const people = [
    person('ceo', null),
    person('vp', 'ceo'),
    person('lead', 'vp'),
    person('eng', 'lead'),
    person('eng2', 'lead'),
    person('other', null),
  ];
  const ids = (list: UserListItem[]) => list.map((p) => p.id);

  it('фокус: цепочка вверх + прямые подчинённые, без чужих', () => {
    expect(ids(focusSubset(people, 'lead', new Set()))).toEqual([
      'ceo',
      'vp',
      'lead',
      'eng',
      'eng2',
    ]);
  });
  it('раскрытый узел добавляет своих подчинённых пошагово', () => {
    const subset = focusSubset(people, 'vp', new Set(['lead']));
    expect(ids(subset)).toEqual(['ceo', 'vp', 'lead', 'eng', 'eng2']);
    const deeper = focusSubset(people, 'ceo', new Set(['vp', 'lead']));
    expect(ids(deeper)).toEqual(['ceo', 'vp', 'lead', 'eng', 'eng2']);
  });
  it('нераскрытые дети считаются для кнопки «+N»', () => {
    const rendered = new Set(ids(focusSubset(people, 'lead', new Set())));
    expect(hiddenReportsCount(people, rendered, 'lead')).toBe(0);
    expect(hiddenReportsCount(people, new Set(['lead']), 'lead')).toBe(2);
  });
});
