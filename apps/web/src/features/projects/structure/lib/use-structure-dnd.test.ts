import { describe, expect, it } from 'vitest';
import type { ProjectNode } from '@nodus/contracts';

import { nodeDropPlacement } from './use-structure-dnd.js';

const EMPTY = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
};

const node = (id: string, parentId: string | null = null): ProjectNode => ({
  id,
  parentId,
  kindId: 'kind-1',
  name: id,
  code: null,
  rollup: EMPTY,
  createdAt: '2026-09-01T00:00:00Z',
});

describe('nodeDropPlacement (DnD узлов структуры)', () => {
  const nodes = [node('a'), node('b', 'a'), node('c', 'a')];
  const expanded = () => true;

  it('дроп на собственную строку — нельзя: якорь не сам переносимый узел', () => {
    expect(nodeDropPlacement(nodes, 'a', 'node:a', 'before', expanded)).toBeNull();
    expect(nodeDropPlacement(nodes, 'a', 'node:a', 'after', expanded)).toBeNull();
    // Низ раскрытого родителя = первым ребёнком: если это сам узел — тоже нет.
    expect(nodeDropPlacement(nodes, 'b', 'node:a', 'after', expanded)).toBeNull();
  });

  it('обычный перенос — родитель и якорь', () => {
    // Свёрнутый/лист: низ строки = сразу после узла.
    expect(nodeDropPlacement(nodes, 'c', 'node:b', 'after', () => false)).toEqual({
      parentId: 'a',
      afterId: 'b',
    });
    expect(nodeDropPlacement(nodes, 'c', 'node:a', 'into', expanded)).toEqual({
      parentId: 'a',
    });
  });

  it('цикл (узел в собственное поддерево) — нельзя', () => {
    expect(nodeDropPlacement(nodes, 'a', 'node:b', 'into', expanded)).toBeNull();
  });
});
