// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectNode } from '@nodus/contracts';

import { nodeDropPlacement, useStructureDnd, type DragPayload } from './use-structure-dnd.js';

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
  customFields: {},
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

/**
 * A6-5/A6-8: индикация дропа не должна перерисовывать дерево на каждый
 * mousemove (state сетался новым объектом всегда), а таймер авто-раскрытия
 * не должен переживать размонтирование вкладки.
 */

const DND_NODES = [node('a'), node('b', 'a'), node('c', 'a')];

const dragStart = (payload: DragPayload): DragStartEvent =>
  ({ active: { data: { current: payload } } }) as unknown as DragStartEvent;

/** Курсор по вертикали внутри строки высотой 100: <25 % — before, >75 % — after. */
const dragMove = (overId: string, y: number): DragMoveEvent =>
  ({
    activatorEvent: { clientY: 0 },
    delta: { x: 0, y },
    over: { id: overId, rect: { top: 0, height: 100 } },
  }) as unknown as DragMoveEvent;

function setup() {
  const expand = vi.fn();
  const onDropNode = vi.fn();
  const onDropTasks = vi.fn();
  let renders = 0;
  const { result, unmount } = renderHook(() => {
    renders += 1;
    return useStructureDnd({
      nodes: DND_NODES,
      expanded: () => false,
      expand,
      onDropNode,
      onDropTasks,
    });
  });
  return { result, unmount, expand, onDropNode, onDropTasks, renders: () => renders };
}

describe('useStructureDnd: индикация без лишних рендеров (A6-5)', () => {
  it('mousemove в той же зоне не сетит state (0 лишних рендеров)', () => {
    const { result, renders } = setup();
    act(() => result.current.context.onDragStart?.(dragStart({ kind: 'node', nodeId: 'c' })));
    const afterStart = renders();

    act(() => result.current.context.onDragMove?.(dragMove('node:b', 50)));
    const afterFirstMove = renders();
    expect(afterFirstMove).toBeGreaterThan(afterStart);
    expect(result.current.dropTarget).toEqual({ overId: 'node:b', zone: 'into', invalid: false });

    // Тот же адрес, та же зона, тот же запрет — цель дропа не изменилась.
    act(() => result.current.context.onDragMove?.(dragMove('node:b', 55)));
    act(() => result.current.context.onDragMove?.(dragMove('node:b', 60)));
    expect(renders()).toBe(afterFirstMove);
    expect(result.current.dropTarget).toEqual({ overId: 'node:b', zone: 'into', invalid: false });

    // Смена зоны — законный рендер (линия вставки переезжает).
    act(() => result.current.context.onDragMove?.(dragMove('node:b', 95)));
    expect(renders()).toBeGreaterThan(afterFirstMove);
    expect(result.current.dropTarget).toEqual({ overId: 'node:b', zone: 'after', invalid: false });
  });

  it('дроп использует последнюю цель: после серии одинаковых move перенос верный', () => {
    const { result, onDropNode } = setup();
    act(() => result.current.context.onDragStart?.(dragStart({ kind: 'node', nodeId: 'c' })));
    act(() => result.current.context.onDragMove?.(dragMove('node:b', 50)));
    act(() => result.current.context.onDragMove?.(dragMove('node:b', 55)));
    act(() => result.current.context.onDragEnd?.({} as never));
    expect(onDropNode).toHaveBeenCalledWith('c', 'b', undefined, undefined);
  });
});

describe('useStructureDnd: таймер авто-раскрытия (A6-8)', () => {
  it('unmount снимает отложенное раскрытие — expand не зовётся', () => {
    vi.useFakeTimers();
    try {
      const { result, unmount, expand } = setup();
      act(() => result.current.context.onDragStart?.(dragStart({ kind: 'node', nodeId: 'c' })));
      act(() => result.current.context.onDragMove?.(dragMove('node:b', 50)));
      unmount();
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(expand).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('до unmount таймер работает: свёрнутая папка раскрывается через 700 мс', () => {
    vi.useFakeTimers();
    try {
      const { result, expand } = setup();
      act(() => result.current.context.onDragStart?.(dragStart({ kind: 'node', nodeId: 'c' })));
      act(() => result.current.context.onDragMove?.(dragMove('node:b', 50)));
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(expand).toHaveBeenCalledWith('b');
    } finally {
      vi.useRealTimers();
    }
  });
});
