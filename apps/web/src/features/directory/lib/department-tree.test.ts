import { describe, expect, it } from 'vitest';
import type { DepartmentNode } from '@nodus/contracts';

import {
  departmentPath,
  departmentTrail,
  findDepartment,
  insertDepartment,
  keepChain,
  patchDepartment,
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

const tree = (): DepartmentNode[] => [node('a', 2, [node('b', 3, [node('c', 5)]), node('d', 1)])];

describe('departmentPath / findDepartment', () => {
  it('путь от корня до узла — для раскрытия предков при центрировании', () => {
    expect(departmentPath(tree(), 'c')?.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(departmentPath(tree(), 'missing')).toBeNull();
  });

  it('узел по id на глубине', () => {
    expect(findDepartment(tree(), 'd')?.name).toBe('dept-d');
    expect(findDepartment(tree(), 'missing')).toBeNull();
  });
});

describe('departmentTrail — след спуска', () => {
  it('маршрут рёбрами от корня до выбранного', () => {
    expect(departmentTrail(tree(), 'c')).toEqual([
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'c' },
    ]);
  });

  it('корень и отсутствующий узел — следа нет', () => {
    expect(departmentTrail(tree(), 'a')).toEqual([]);
    expect(departmentTrail(tree(), 'missing')).toEqual([]);
  });
});

describe('keepChain — аккордеон раскрытий', () => {
  it('клик по соседу на уровне срезает всё глубже него', () => {
    expect(keepChain(['a', 'b', 'c'], 1, 'd')).toEqual(['a', 'd']);
  });

  it('клик по уже раскрытому предку глубокие уровни сохраняет', () => {
    expect(keepChain(['a', 'b', 'c'], 1, 'b')).toEqual(['a', 'b', 'c']);
    expect(keepChain(['a', 'b', 'c'], 0, 'a')).toEqual(['a', 'b', 'c']);
  });

  it('раскрытие нового уровня продолжает цепочку', () => {
    expect(keepChain(['a', 'b'], 2, 'c')).toEqual(['a', 'b', 'c']);
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
