import { describe, expect, it } from 'vitest';
import type { LetterTreeNode, LetterTreeResponse } from '@nodus/contracts';

import {
  findTreeNode,
  flattenLetterTree,
  treeNodeCount,
  treeNodeOf,
  withRelation,
  withoutRelation,
} from './letter-tree.js';

const node = (id: string, children: LetterTreeNode[] = []): LetterTreeNode => ({
  id,
  regNumber: null,
  theirNumber: null,
  subject: `Письмо ${id}`,
  direction: 'incoming',
  systemState: 'active',
  confidential: false,
  relationId: null,
  relationKind: null,
  children,
});

const tree = (root: LetterTreeNode): LetterTreeResponse => ({ root, truncated: false });

describe('дерево «ёлочки» (#461, Р2): оптимистичные операции', () => {
  it('узел из строки списка: связь и дети пусты', () => {
    const built = treeNodeOf({
      id: 'c',
      regNumber: 'Вх-2026/3',
      theirNumber: null,
      subject: null,
      direction: 'outgoing',
      stage: { systemState: 'done' },
      confidential: true,
    });
    expect(built).toMatchObject({
      id: 'c',
      relationId: null,
      relationKind: null,
      children: [],
      confidential: true,
    });
  });

  it('корень цепочки получает связь: цель — новый верх, источник с детьми под ней', () => {
    // Дерево: A ← B ← D. Связываем корень A с внешним C: C становится
    // родителем A, вся ветка (дети источника) едет вместе с ним.
    const base = tree(node('a', [{ ...node('b', [node('d')]), relationId: 'r1' }]));
    const linked = withRelation(base, 'a', treeNodeOf(listItem('c')), 'nested_in');
    expect(linked.root.id).toBe('c');
    expect(linked.root.children.map((child) => child.id)).toEqual(['a']);
    expect(linked.root.children[0]?.relationKind).toBe('nested_in');
    expect(findTreeNode(linked.root, 'd')).not.toBeNull();
  });

  it('цель уже в дереве: источник с поддеревом переезжает под неё, цепочка цела', () => {
    // Дерево: A ← B, A ← C. Связываем B с C: B уходит под C (у B одна связь
    // вида — старое вхождение по тому же виду снимается), A остаётся верхом.
    const base = tree(
      node('a', [
        { ...node('b', [node('d')]), relationKind: 'reply_to', relationId: 'r1' },
        { ...node('c'), relationKind: 'reply_to', relationId: 'r2' },
      ]),
    );
    const linked = withRelation(base, 'b', treeNodeOf(listItem('c')), 'reply_to');
    expect(linked.root.id).toBe('a');
    expect(linked.root.children.map((child) => child.id)).toEqual(['c']);
    expect(linked.root.children[0]?.children.map((child) => child.id)).toEqual(['b']);
    expect(findTreeNode(linked.root, 'd')).not.toBeNull();
  });

  it('цель внутри ветки источника — круг: дерево не трогаем (сервер откажет)', () => {
    const base = tree(node('a', [{ ...node('b', [node('d')]), relationId: 'r1' }]));
    expect(withRelation(base, 'a', treeNodeOf(listItem('d')), 'reply_to')).toEqual(base);
  });

  it('источник в середине, цель снаружи — ждём сервер (где встанет ветка, решает он)', () => {
    const base = tree(node('a', [{ ...node('b'), relationKind: 'reply_to', relationId: 'r1' }]));
    expect(withRelation(base, 'b', treeNodeOf(listItem('c')), 'reply_to')).toEqual(base);
    // Источника нет в дереве — тоже без изменений.
    expect(withRelation(base, 'zzz', treeNodeOf(listItem('c')), 'nested_in')).toEqual(base);
  });

  it('снятие убирает узел с поддеревом, соседей не трогает', () => {
    const base = tree(
      node('a', [
        { ...node('b', [{ ...node('d'), relationId: 'r2' }]), relationId: 'r1' },
        { ...node('c'), relationId: 'r3' },
      ]),
    );
    const next = withoutRelation(base, 'r1');
    expect(next.root.children.map((child) => child.id)).toEqual(['c']);
    expect(findTreeNode(next.root, 'd')).toBeNull();
    expect(findTreeNode(next.root, 'c')?.id).toBe('c');
  });

  it('«цепочка + ветки»: линейные ответы плоско, отступ — на ветвлении и матрёшке', () => {
    // A ← B ← C (линейная переписка), у A два вложенных письма N1/N2,
    // у C — ветвление: два ответа D1/D2.
    const base = tree(
      node('a', [
        { ...node('n1'), relationKind: 'nested_in', relationId: 'r-n1' },
        { ...node('n2'), relationKind: 'nested_in', relationId: 'r-n2' },
        {
          ...node('b', [
            {
              ...node('c', [
                { ...node('d1'), relationKind: 'reply_to', relationId: 'r-d1' },
                { ...node('d2'), relationKind: 'reply_to', relationId: 'r-d2' },
              ]),
              relationKind: 'reply_to',
              relationId: 'r-c',
            },
          ]),
          relationKind: 'reply_to',
          relationId: 'r-b',
        },
      ]),
    );
    const rows = flattenLetterTree(base.root, new Set());
    expect(rows.map((row) => `${row.node.id}:${row.depth}`)).toEqual([
      'a:0',
      'n1:1',
      'n2:1',
      'b:0', // ответ продолжает ствол — без отступа
      'c:0',
      'd1:1', // ветвление — отступ
      'd2:1',
    ]);
    // Порядок — старые сверху: родитель выше своего ответа.
    const order = rows.map((row) => row.node.id);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    // Чипы: у A — два вложенных, у C — два ответа.
    expect(rows.find((row) => row.node.id === 'a')?.nested).toBe(2);
    expect(rows.find((row) => row.node.id === 'c')?.replies).toBe(2);
    // Ребро ствола знает родителя.
    expect(rows.find((row) => row.node.id === 'b')?.parentKey).toBe(rows[0]?.key);
  });

  it('свёрнутая ветка прячет продолжение цепочки и поддерево', () => {
    const base = tree(node('a', [{ ...node('b', [node('c')]), relationId: 'r-b' }]));
    const rows = flattenLetterTree(base.root, new Set([`r-b:b`]));
    expect(rows.map((row) => row.node.id)).toEqual(['a', 'b']);
  });

  it('счётчик узлов и поиск узла', () => {
    const base = tree(node('a', [node('b', [node('d')]), node('c')]));
    expect(treeNodeCount(base.root)).toBe(4);
    expect(findTreeNode(base.root, 'd')?.subject).toBe('Письмо d');
    expect(findTreeNode(base.root, 'nope')).toBeNull();
  });
});

function listItem(id: string) {
  return {
    id,
    regNumber: null,
    theirNumber: null,
    subject: null,
    direction: 'incoming' as const,
    stage: { systemState: 'active' as const },
    confidential: false,
  };
}
