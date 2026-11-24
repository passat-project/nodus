// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { TaskListItem } from '@nodus/contracts';

import { buildTaskRows } from '../lib/task-tree.js';
import { TaskListTree } from './task-list-graph.js';

/**
 * #1018: импульс раскрытия рисует ствол САМОЙ раскрытой ветки и её новые
 * отводы, а не ствол следующей задачи с подзадачами. Диапазон анимации —
 * от строки раскрытого узла до конца его видимого поддерева.
 */

function task(id: string, parentId: string | null = null): TaskListItem {
  return { id, parentId, title: id } as TaskListItem;
}

const pathsOf = (container: HTMLElement) => Array.from(container.querySelectorAll('path'));
const drawn = (path: SVGPathElement) =>
  (path.getAttribute('class') ?? '').includes('node-edge-draw');

function renderTree(items: TaskListItem[], reveal: { taskId: string | null; key: number } | null) {
  return render(<TaskListTree rows={buildTaskRows(items)} width={200} reveal={reveal} />);
}

/** A с детьми A1/A2 (B — следующая ветка с B1): ствол A, отвод A1, ствол B. */
const TWO_BRANCHES = [task('A'), task('B'), task('A1', 'A'), task('A2', 'A'), task('B1', 'B')];

afterEach(cleanup);

describe('TaskListTree — диапазон импульса раскрытия (#1018)', () => {
  it('раскрытие верхней ветки: её ствол с задержкой 0 и отвод, следующая ветка не переигрывается', () => {
    const view = renderTree(TWO_BRANCHES, { taskId: 'A', key: 2 });
    const [stemA, branchA1, stemB] = pathsOf(view.container);

    expect(drawn(stemA!)).toBe(true);
    expect(stemA!.style.animationDelay).toBe('0ms');
    expect(drawn(branchA1!)).toBe(true);
    expect(branchA1!.style.animationDelay).toBe('28ms');
    // Ствол следующей задачи существовал до раскрытия — анимации нет.
    expect(drawn(stemB!)).toBe(false);
    expect(stemB!.style.animationDelay).toBe('');
  });

  it('раскрытие вложенной ветки рисует её ствол, а не стволы предка и соседа', () => {
    const view = renderTree(
      [task('A'), task('B'), task('A1', 'A'), task('B1', 'B'), task('A1a', 'A1')],
      { taskId: 'A1', key: 3 },
    );
    const [stemA, stemA1, stemB] = pathsOf(view.container);

    expect(drawn(stemA!)).toBe(false);
    expect(drawn(stemA1!)).toBe(true);
    expect(stemA1!.style.animationDelay).toBe('0ms');
    expect(drawn(stemB!)).toBe(false);
  });

  it('стартовая загрузка — прежний каскад по всему списку', () => {
    const view = renderTree(TWO_BRANCHES, { taskId: null, key: 1 });
    const paths = pathsOf(view.container);

    expect(paths.map(drawn)).toEqual([true, true, true]);
    expect(paths.map((path) => path.style.animationDelay)).toEqual(['0ms', '28ms', '84ms']);
  });

  it('сворачивание — без анимации', () => {
    const view = renderTree(TWO_BRANCHES, null);
    expect(pathsOf(view.container).map(drawn)).toEqual([false, false, false]);
  });
});
