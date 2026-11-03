import { describe, expect, it } from 'vitest';
import type { ProjectNode, ProjectNodeRollup, TaskListItem } from '@nodus/contracts';

import {
  applyNodeMove,
  buildStructureRows,
  filterStructureRows,
  filterVisibleRows,
  subtreeNodeIds,
} from './structure-tree.js';

const systemProcessType = {
  id: '20000000-0000-4000-8000-000000000900',
  code: 'task',
  name: 'Задача',
  category: 'task',
  icon: 'square-check',
  color: 'info',
} as const;

const STAGE_ACTIVE = {
  id: 's1',
  name: 'В работе',
  order: 1,
  systemState: 'active',
  color: 'info',
} as const;

const rollup = (over: Partial<ProjectNodeRollup> = {}): ProjectNodeRollup => ({
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
  ...over,
});

function node(
  id: string,
  parentId: string | null = null,
  over: Partial<ProjectNode> = {},
): ProjectNode {
  return {
    id,
    parentId,
    kindId: 'kind-1',
    name: `Узел ${id}`,
    code: null,
    customFields: {},
    rollup: rollup(),
    createdAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

let seq = 0;
function task(id: string, nodeId: string | null, parentId: string | null = null): TaskListItem {
  seq += 1;
  return {
    id,
    number: seq,
    title: `Задача ${id}`,
    type: systemProcessType,
    stage: STAGE_ACTIVE,
    personalStageId: null,
    customFields: {},
    priority: 'normal',
    deadline: null,
    creator: { id: 'u1', displayName: 'Тест Тест', avatarUrl: null },
    assignee: null,
    participants: [],
    project: null,
    parentId,
    nodeId,
    spentMinutes: 0,
    plannedMinutes: null,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

describe('buildStructureRows (дерево структуры проекта)', () => {
  it('DFS: папки выше файлов, задачи-листья под своим узлом', () => {
    const nodes = [node('b1'), node('ar', 'b1'), node('kr', 'b1')];
    const rows = buildStructureRows(nodes, [task('t1', 'ar'), task('t2', 'kr'), task('t3', null)]);
    expect(
      rows.map((r) =>
        r.kind === 'node'
          ? `n:${r.node.id}:${r.depth}`
          : r.kind === 'task'
            ? `t:${r.task.id}:${r.depth}`
            : 'noNode',
      ),
    ).toEqual(['n:b1:0', 'n:ar:1', 't:t1:2', 'n:kr:1', 't:t2:2', 'noNode', 't:t3:0']);
  });

  it('агрегаты поддерева: суммы и MIN/MAX сроков из ПРЯМЫХ rollup узлов', () => {
    const nodes = [
      node('b1', null, {
        rollup: rollup({ taskCount: 2, doneCount: 1, plannedMinutes: 300, spentMinutes: 120 }),
      }),
      node('ar', 'b1', {
        rollup: rollup({
          taskCount: 4,
          doneCount: 2,
          plannedMinutes: 600,
          spentMinutes: 480,
          nearestDeadline: '2026-11-05T00:00:00Z',
          latestDeadline: '2026-11-20T00:00:00Z',
        }),
      }),
      node('kr', 'b1', {
        rollup: rollup({
          taskCount: 1,
          doneCount: 1,
          nearestDeadline: '2026-11-01T00:00:00Z',
          latestDeadline: '2026-12-01T00:00:00Z',
        }),
      }),
    ];
    const rows = buildStructureRows(nodes, []);
    const root = rows.find((r) => r.kind === 'node' && r.node.id === 'b1');
    expect(root).toMatchObject({
      subtree: {
        taskCount: 7,
        doneCount: 4,
        plannedMinutes: 900,
        spentMinutes: 600,
        nearestDeadline: '2026-11-01T00:00:00Z',
        latestDeadline: '2026-12-01T00:00:00Z',
      },
    });
  });

  it('счётчик свёрнутой ветки: все потомки — узлы и задачи', () => {
    const nodes = [node('b1'), node('ar', 'b1'), node('kr', 'b1')];
    const rows = buildStructureRows(nodes, [task('t1', 'ar'), task('t2', 'kr'), task('t3', null)]);
    const root = rows.find((r) => r.kind === 'node' && r.node.id === 'b1');
    const ar = rows.find((r) => r.kind === 'node' && r.node.id === 'ar');
    expect(root).toMatchObject({ descendantCount: 4 });
    expect(ar).toMatchObject({ descendantCount: 1 });
  });

  it('подзадача вложена под родительскую задачу, а не на её уровень', () => {
    const nodes = [node('b1'), node('ar', 'b1')];
    const rows = buildStructureRows(nodes, [
      task('t1', 'ar'),
      task('t2', 'ar', 't1'),
      task('t3', 'ar', 't2'),
    ]);
    expect(
      rows.map((r) =>
        r.kind === 'node'
          ? `n:${r.node.id}:${r.depth}`
          : r.kind === 'task'
            ? `t:${r.task.id}:${r.depth}`
            : 'noNode',
      ),
    ).toEqual(['n:b1:0', 'n:ar:1', 't:t1:2', 't:t2:3', 't:t3:4']);
    const parent = rows.find((r) => r.kind === 'task' && r.task.id === 't1');
    expect(parent).toMatchObject({ hasChildren: true, descendantCount: 2 });
    expect(
      filterVisibleRows(rows, new Set(['t1'])).map((r) =>
        r.kind === 'node' ? r.node.id : r.kind === 'task' ? r.task.id : 'noNode',
      ),
    ).toEqual(['b1', 'ar', 't1']);
  });

  it('задача с nodeId вне набора узлов уходит в «Без узла»', () => {
    const rows = buildStructureRows([node('b1')], [task('t1', 'ghost'), task('t2', 'b1')]);
    const noNode = rows.find((r) => r.kind === 'noNode');
    expect(noNode).toMatchObject({ kind: 'noNode', count: 1 });
    const last = rows[rows.length - 1];
    expect(last?.kind === 'task' && last.task.id).toBe('t1');
  });

  it('родитель узла вне набора — узел становится корнем', () => {
    const rows = buildStructureRows([node('b1'), node('ar', 'ghost')], []);
    expect(
      rows.filter((r) => r.kind === 'node').every((r) => r.kind === 'node' && r.depth === 0),
    ).toBe(true);
  });
});

describe('filterVisibleRows (сворачивание)', () => {
  const nodes = [node('b1'), node('ar', 'b1'), node('kr', 'b1')];
  const rows = buildStructureRows(nodes, [task('t1', 'ar'), task('t2', 'kr'), task('t3', null)]);

  it('без свёрнутых видны все строки', () => {
    expect(filterVisibleRows(rows, new Set()).length).toBe(rows.length);
  });

  it('свёрнутый узел прячет поддерево и свои задачи, сам узел и «Без узла» видны', () => {
    const visible = filterVisibleRows(rows, new Set(['ar']));
    expect(
      visible.map((r) =>
        r.kind === 'node' ? r.node.id : r.kind === 'task' ? r.task.id : 'noNode',
      ),
    ).toEqual(['b1', 'ar', 'kr', 't2', 'noNode', 't3']);
  });

  it('свёрнутый корень прячет всё до «Без узла»', () => {
    const visible = filterVisibleRows(rows, new Set(['b1']));
    expect(
      visible.map((r) =>
        r.kind === 'node' ? r.node.id : r.kind === 'task' ? r.task.id : 'noNode',
      ),
    ).toEqual(['b1', 'noNode', 't3']);
  });
});

describe('filterStructureRows (поиск по структуре)', () => {
  const nodes = [node('b1'), node('ar', 'b1'), node('kr', 'b1')];
  const rows = buildStructureRows(nodes, [task('t1', 'ar'), task('t2', 'kr'), task('t3', null)]);

  it('находит задачу и оставляет путь предков', () => {
    expect(
      filterStructureRows(rows, 't2').map((r) =>
        r.kind === 'node' ? r.node.id : r.kind === 'task' ? r.task.id : 'noNode',
      ),
    ).toEqual(['b1', 'kr', 't2']);
  });

  it('находит узел по имени и не тянет всё поддерево', () => {
    expect(
      filterStructureRows(rows, 'Узел ar').map((r) =>
        r.kind === 'node' ? r.node.id : r.kind === 'task' ? r.task.id : 'noNode',
      ),
    ).toEqual(['b1', 'ar']);
  });

  it('«Без узла» остаётся только при совпадении её задач', () => {
    const filtered = filterStructureRows(rows, 't3');
    expect(filtered.find((r) => r.kind === 'noNode')).toMatchObject({ count: 1 });
    expect(filtered.some((r) => r.kind === 'task' && r.task.id === 't3')).toBe(true);
    expect(filterStructureRows(rows, 'нет такого')).toEqual([]);
  });
});

describe('subtreeNodeIds / applyNodeMove', () => {
  it('поддерево для блокировки циклов DnD', () => {
    const nodes = [node('b1'), node('ar', 'b1'), node('ar2', 'ar')];
    expect([...subtreeNodeIds(nodes, 'b1')].sort()).toEqual(['ar', 'ar2', 'b1']);
    expect([...subtreeNodeIds(nodes, 'ar')].sort()).toEqual(['ar', 'ar2']);
  });

  it('перенос без якоря — последним ребёнком родителя', () => {
    const nodes = [node('b1'), node('ar', 'b1'), node('kr', 'b1'), node('b2')];
    const moved = applyNodeMove(nodes, 'kr', 'b1');
    expect(moved.map((n) => n.id)).toEqual(['b1', 'ar', 'kr', 'b2']);
    expect(moved.find((n) => n.id === 'kr')?.parentId).toBe('b1');
  });

  it('перенос по якорю beforeId — перед сиблингом', () => {
    const nodes = [node('b1'), node('ar', 'b1'), node('kr', 'b1')];
    const moved = applyNodeMove(nodes, 'kr', 'b1', { beforeId: 'ar' });
    expect(moved.map((n) => n.id)).toEqual(['b1', 'kr', 'ar']);
  });

  it('перенос в корень — в конец списка корней', () => {
    const nodes = [node('b1'), node('ar', 'b1'), node('b2')];
    const moved = applyNodeMove(nodes, 'ar', null);
    expect(moved.map((n) => n.id)).toEqual(['b1', 'b2', 'ar']);
    expect(moved.find((n) => n.id === 'ar')?.parentId).toBeNull();
  });
});
