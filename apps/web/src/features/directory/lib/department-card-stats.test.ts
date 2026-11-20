import { describe, expect, it } from 'vitest';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';

import { buildDepartmentCardStats } from './department-card-stats.js';

/** Данные карточки структуры (#768, пакет 16.11.2026): руководитель, замы,
 *  прямые подчинённые, чип команды (лист/ветка), «беспризорные» главной
 *  карточки, только активные сотрудники. */

const node = (
  id: string,
  children: DepartmentNode[] = [],
  overrides: Partial<DepartmentNode> = {},
): DepartmentNode => ({
  id,
  name: id,
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
  ...overrides,
});

const person = (id: string, overrides: Partial<UserListItem> = {}): UserListItem => ({
  id,
  displayName: id,
  status: 'active',
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

function idsOf(roots: readonly DepartmentNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly DepartmentNode[]) => {
    for (const item of nodes) {
      ids.add(item.id);
      walk(item.children);
    }
  };
  walk(roots);
  return ids;
}

const tree = (): DepartmentNode[] => [
  node(
    'main',
    [
      node('bim', [node('lab', [], { headId: 'h-lab' })], {
        headId: 'h-bim',
        deputyIds: ['d-bim'],
      }),
      node('build'),
    ],
    {
      headId: 'h-main',
      deputyIds: ['d-main'],
    },
  ),
];

describe('buildDepartmentCardStats (#768)', () => {
  const users = (): UserListItem[] => [
    person('h-main', {
      displayName: 'Директор Компании',
      positionName: 'Директор',
      departmentId: 'main',
    }),
    person('d-main', { displayName: 'Заместитель Директора', departmentId: 'main' }),
    person('m1', { departmentId: 'main' }),
    person('orphan', { departmentId: null }),
    person('archived', { departmentId: 'archived' }),
    person('h-bim', {
      displayName: 'Начальник BIM',
      positionName: 'Руководитель BIM',
      departmentId: 'bim',
    }),
    person('d-bim', { departmentId: 'bim' }),
    person('b1', { departmentId: 'bim' }),
    person('h-lab', { departmentId: 'lab' }),
    person('l1', { departmentId: 'lab' }),
    person('dead', { status: 'deactivated', departmentId: 'bim' }),
  ];

  const build = (roots = tree(), list = users()) =>
    buildDepartmentCardStats(roots, list, {
      mainId: 'main',
      activeDepartmentIds: idsOf(roots),
    });

  it('руководитель: имя, должность и аватар из справочника; для главной — тоже', () => {
    const stats = build();
    expect(stats.get('main')?.head).toEqual({
      id: 'h-main',
      name: 'Директор Компании',
      positionName: 'Директор',
      avatarUrl: null,
    });
    expect(stats.get('bim')?.head?.positionName).toBe('Руководитель BIM');
  });

  it('руководителя нет в справочнике — фолбэк на денормализованное имя', () => {
    const roots = [node('main', [], { headId: 'missing', headName: 'Внешний Руководитель' })];
    const stats = buildDepartmentCardStats(roots, [], {
      mainId: 'main',
      activeDepartmentIds: idsOf(roots),
    });
    expect(stats.get('main')?.head).toEqual({
      id: 'missing',
      name: 'Внешний Руководитель',
      positionName: null,
      avatarUrl: null,
    });
  });

  it('подчинённые — только активные члены без руководителя и зама', () => {
    const stats = build();
    expect(stats.get('bim')?.subordinates.map((user) => user.id)).toEqual(['b1']);
    expect(stats.get('lab')?.subordinates.map((user) => user.id)).toEqual(['l1']);
    expect(stats.get('build')?.subordinates).toEqual([]);
  });

  it('чип листа: подчинённые + заместители, руководитель не входит', () => {
    const stats = build();
    expect(stats.get('lab')?.teamCount).toBe(1);
    expect(stats.get('build')?.teamCount).toBe(0);
    expect(stats.get('lab')?.deputies).toEqual([]);
  });

  it('чип ветки: плюс вся ветка с руководителями подразделений, без дублей', () => {
    const stats = build();
    // b1 + зам + руководитель лаборатории + сотрудник лаборатории.
    expect(stats.get('bim')?.teamCount).toBe(4);
    // b1 + h-bim + зам + лаборатория (h-lab, l1) + m1 + независимый + архивный.
    expect(stats.get('main')?.teamCount).toBe(9);
  });

  it('главная карточка: «беспризорные» в подчинённых, остальные отделы — нет', () => {
    const stats = build();
    expect(stats.get('main')?.subordinates.map((user) => user.id)).toEqual([
      'm1',
      'orphan',
      'archived',
    ]);
    expect(stats.get('bim')?.subordinates.map((user) => user.id)).not.toContain('orphan');
  });

  it('зам, совпадающий с руководителем, не дублируется; отделы в футере', () => {
    const roots = [node('main', [node('a'), node('b')], { headId: 'both', deputyIds: ['both'] })];
    const stats = buildDepartmentCardStats(roots, [person('both', { departmentId: 'main' })], {
      mainId: 'main',
      activeDepartmentIds: idsOf(roots),
    });
    expect(stats.get('main')?.deputies).toEqual([]);
    expect(stats.get('main')?.subordinates).toEqual([]);
    expect(stats.get('main')?.teamCount).toBe(0);
    expect(stats.get('main')?.departmentCount).toBe(2);
  });
});
