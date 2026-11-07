import { describe, expect, it } from 'vitest';

import { keyBetween } from '../../core/lib/fractional-index.js';
import {
  childrenByParent,
  isDescendantOf,
  nodeDepth,
  orderKeyFor,
  parentOf,
  subtreeHeight,
  subtreeIds,
  type TreeNodeLike,
} from './project-structure.tree.js';

/**
 * Чистые расчёты дерева структуры (#467): глубина/циклы/высота поддерева и
 * ключи порядка при переносе. Порядок детей — байтовый (COLLATE "C"),
 * ключи генерирует core/lib/fractional-index.
 */

const K = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'] as const;
const order = (index: number): string => K[index]!;

function node(id: string, parentId: string | null, orderIndex: number): TreeNodeLike {
  return { id, parentId, order: order(orderIndex) };
}

/** Цепочка root → c1 → c2 → … заданной длины (индексы порядка по siblings). */
function chain(depth: number): TreeNodeLike[] {
  const nodes: TreeNodeLike[] = [node('root', null, 0)];
  for (let kind = 1; kind < depth; kind++) nodes.push(node(`c${kind}`, nodes.at(-1)!.id, 0));
  return nodes;
}

describe('project-structure.tree: дети и родители', () => {
  it('дети сгруппированы по родителю и отсортированы по ключу', () => {
    const nodes = [node('b', 'p', 2), node('a', 'p', 0), node('c', 'p', 1), node('root', null, 3)];
    const children = childrenByParent(nodes);
    expect(children.get('p')!.map((n) => n.id)).toEqual(['a', 'c', 'b']);
    expect(children.get(null)!.map((n) => n.id)).toEqual(['root']);
    expect(children.get('missing')).toBeUndefined();
  });

  it('parentOf строит карту id → parentId', () => {
    const parents = parentOf([node('a', null, 0), node('b', 'a', 0)]);
    expect(parents.get('a')).toBeNull();
    expect(parents.get('b')).toBe('a');
    expect(parents.get('ghost')).toBeUndefined();
  });

  it('subtreeIds — узел включительно, DFS в порядке братьев, соседи не попадают', () => {
    const nodes = [
      node('root', null, 0),
      node('a', 'root', 0),
      node('b', 'root', 1),
      node('a1', 'a', 0),
      node('a2', 'a', 1),
      node('a21', 'a2', 0),
    ];
    const children = childrenByParent(nodes);
    expect(subtreeIds(children, 'a')).toEqual(['a', 'a1', 'a2', 'a21']);
    expect(subtreeIds(children, 'b')).toEqual(['b']);
    expect(subtreeIds(children, 'ghost')).toEqual(['ghost']);
  });

  it('subtreeIds не зацикливается на испорченном дереве', () => {
    const broken: TreeNodeLike[] = [node('x', 'y', 0), node('y', 'x', 0)];
    expect(() => subtreeIds(childrenByParent(broken), 'x')).not.toThrow();
    expect(subtreeIds(childrenByParent(broken), 'x')).toEqual(['x', 'y']);
  });
});

describe('project-structure.tree: глубина и циклы', () => {
  it('глубина корня = 1, цепочка длины N даёт глубину N у листа', () => {
    for (const depth of [1, 3, 10]) {
      const parents = parentOf(chain(depth));
      expect(nodeDepth(parents, 'root')).toBe(1);
      expect(nodeDepth(parents, `c${depth - 1}`)).toBe(depth);
    }
  });

  it('потомок определяется вверх по цепочке; сам себе — не потомок', () => {
    const parents = parentOf(chain(4)); // root → c1 → c2 → c3
    expect(isDescendantOf(parents, 'c3', 'root')).toBe(true);
    expect(isDescendantOf(parents, 'c3', 'c2')).toBe(true);
    expect(isDescendantOf(parents, 'root', 'c3')).toBe(false);
    expect(isDescendantOf(parents, 'c1', 'c1')).toBe(false);
    expect(isDescendantOf(parents, 'ghost', 'root')).toBe(false);
  });

  it('высота поддерева считает узел за 1 и ветвление', () => {
    const nodes = [
      node('root', null, 0),
      node('a', 'root', 0),
      node('b', 'root', 1),
      node('a1', 'a', 0),
      node('a2', 'a', 1),
      node('a1x', 'a1', 0),
    ];
    expect(subtreeHeight(childrenByParent(nodes), 'root')).toBe(4);
    expect(subtreeHeight(childrenByParent(nodes), 'a')).toBe(3);
    expect(subtreeHeight(childrenByParent(nodes), 'b')).toBe(1);
  });

  it('испорченный цикл не зацикливает обход (предохранители)', () => {
    const broken: TreeNodeLike[] = [node('x', 'y', 0), node('y', 'x', 0)];
    const parents = parentOf(broken);
    expect(() => nodeDepth(parents, 'x')).not.toThrow();
    expect(() => subtreeHeight(childrenByParent(broken), 'x')).not.toThrow();
    expect(() => isDescendantOf(parents, 'x', 'q')).not.toThrow();
  });
});

describe('project-structure.tree: ключи порядка при переносе', () => {
  it('без якоря — ключ после последнего брата', () => {
    const siblings = ['a1', 'a3', 'a5'];
    const key = orderKeyFor(siblings, null, 'end');
    expect(key > siblings.at(-1)!).toBe(true);
    expect(keyBetween(siblings.at(-1)!, null)).toBe(key);
  });

  it('before: строго между предыдущим братом и якорем', () => {
    const siblings = ['a1', 'a3', 'a5'];
    const key = orderKeyFor(siblings, 'a3', 'before');
    expect(key > 'a1').toBe(true);
    expect(key < 'a3').toBe(true);
  });

  it('after: строго между якорем и следующим братом', () => {
    const siblings = ['a1', 'a3', 'a5'];
    const key = orderKeyFor(siblings, 'a3', 'after');
    expect(key > 'a3').toBe(true);
    expect(key < 'a5').toBe(true);
  });

  it('якорь краями: before первого и after последнего', () => {
    const siblings = ['a1', 'a3'];
    expect(orderKeyFor(siblings, 'a1', 'before') < 'a1').toBe(true);
    const last = orderKeyFor(siblings, 'a3', 'after');
    expect(last > 'a3').toBe(true);
  });

  it('якорь вне списка братьев — ошибка (инвариант сервиса)', () => {
    expect(() => orderKeyFor(['a1'], 'a5', 'before')).toThrow(/anchor/);
  });

  it('пустой список — стартовый ключ', () => {
    expect(orderKeyFor([], null, 'end')).toBe(keyBetween(null, null));
  });
});
