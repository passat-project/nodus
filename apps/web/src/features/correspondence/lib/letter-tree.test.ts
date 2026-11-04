import { describe, expect, it } from 'vitest';
import type { LetterTreeNode, LetterTreeResponse } from '@nodus/contracts';

import {
  findTreeNode,
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

  it('связь встаёт ребёнком источника; замена отсекает прежнюю того же вида', () => {
    const base = tree(node('a', [{ ...node('b'), relationKind: 'reply_to', relationId: 'r1' }]));
    const linked = withRelation(base, 'a', treeNodeOf(listItem('c')), 'nested_in', false);
    expect(linked.root.children.map((child) => child.id)).toEqual(['b', 'c']);
    expect(linked.root.children[1]?.relationKind).toBe('nested_in');

    const replaced = withRelation(base, 'a', treeNodeOf(listItem('c')), 'reply_to', true);
    expect(replaced.root.children.map((child) => child.id)).toEqual(['c']);
    expect(replaced.root.children[0]?.relationKind).toBe('reply_to');
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
