import { describe, expect, it } from 'vitest';
import type { TaskListItem, TaskStage } from '@nodus/contracts';

import { buildTaskRows, filterVisibleRows } from './task-tree.js';

const systemProcessType = {
  id: '20000000-0000-4000-8000-000000000900',
  code: 'task',
  name: 'Задача',
  category: 'task',
  icon: 'square-check',
  color: 'info',
} as const;

const STAGE: TaskStage = {
  id: 's1',
  name: 'Новые',
  order: 1,
  systemState: 'active',
  color: 'info',
};

let seq = 0;
function task(id: string, parentId: string | null = null): TaskListItem {
  seq += 1;
  return {
    id,
    number: seq,
    title: `Задача ${id}`,
    type: systemProcessType,
    stage: STAGE,
    personalStageId: null,
    customFields: {},
    priority: 'normal',
    deadline: null,
    creator: { id: 'u1', displayName: 'Тест Тест', avatarUrl: null },
    assignee: null,
    participants: [],
    project: null,
    parentId,
    nodeId: null,
    spentMinutes: 0,
    plannedMinutes: null,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

describe('buildTaskRows (дерево журнала задач)', () => {
  it('DFS: дети — сразу за родителем; глубина и hasChildren верны', () => {
    const rows = buildTaskRows([task('a'), task('b', 'a'), task('c', 'b'), task('d')]);
    expect(rows.map((r) => `${r.task.id}:${r.depth}`)).toEqual(['a:0', 'b:1', 'c:2', 'd:0']);
    expect(rows.find((r) => r.task.id === 'a')?.hasChildren).toBe(true);
    expect(rows.find((r) => r.task.id === 'c')?.hasChildren).toBe(false);
  });

  it('childCount — полное число потомков (для счётчика свёрнутой ветки)', () => {
    const rows = buildTaskRows([task('a'), task('b', 'a'), task('c', 'b'), task('d', 'a')]);
    expect(rows.find((r) => r.task.id === 'a')?.childCount).toBe(3);
    expect(rows.find((r) => r.task.id === 'b')?.childCount).toBe(1);
  });

  it('родитель за пределами выборки — узел отображается корнем', () => {
    const rows = buildTaskRows([task('a', 'ghost'), task('b', 'a')]);
    expect(rows.map((r) => `${r.task.id}:${r.depth}`)).toEqual(['a:0', 'b:1']);
  });

  it('геометрия связей: elbowFrom, isLast, passThrough', () => {
    const rows = buildTaskRows([task('a'), task('b', 'a'), task('c', 'a'), task('d')]);
    const [a, b, c, d] = rows;
    expect(a?.elbowFrom).toBeNull();
    expect(b?.elbowFrom).toBe(0);
    expect(c?.isLast).toBe(true); // последний сиблинг ветки a
    expect(b?.isLast).toBe(false);
    expect(c?.passThrough).toEqual([]); // у a ниже b сиблингов нет — вертикаль не тянется
    expect(d?.depth).toBe(0);
  });

  it('сквозная вертикаль живёт, пока у предка есть сиблинги ниже', () => {
    // a(0) → b1(1) → c(2); после b1 есть сиблинг b2 → вертикаль уровня 0
    // проходит c насквозь (у b1 ниже есть узел b2).
    const rows = buildTaskRows([task('a'), task('b1', 'a'), task('c', 'b1'), task('b2', 'a')]);
    expect(rows.find((r) => r.task.id === 'c')?.passThrough).toContain(0);
    // b2 — последний сиблинг: сквозных вертикалей у него нет.
    expect(rows.find((r) => r.task.id === 'b2')?.passThrough).toEqual([]);
  });
});

describe('filterVisibleRows (сворачивание веток)', () => {
  it('свёрнутая ветка скрывает всех потомков, сиблинги и следующие корни видны', () => {
    const rows = buildTaskRows([task('a'), task('b', 'a'), task('c', 'b'), task('d')]);
    const visible = filterVisibleRows(rows, new Set(['a']));
    expect(visible.map((r) => r.task.id)).toEqual(['a', 'd']);
  });

  it('сворачивание глубокой ветки скрывает только её поддерево', () => {
    const rows = buildTaskRows([task('a'), task('b', 'a'), task('c', 'b'), task('e', 'a')]);
    const visible = filterVisibleRows(rows, new Set(['b']));
    expect(visible.map((r) => r.task.id)).toEqual(['a', 'b', 'e']);
  });

  it('без свёрнутых — все строки видны', () => {
    const rows = buildTaskRows([task('a'), task('b', 'a')]);
    expect(filterVisibleRows(rows, new Set()).map((r) => r.task.id)).toEqual(['a', 'b']);
  });
});
