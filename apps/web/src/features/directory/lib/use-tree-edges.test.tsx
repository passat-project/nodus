// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

import { useTreeEdges, type TreeLink } from './use-tree-edges.js';

/** Геометрия рёбер структуры (#768): шина/ствол/отводы по фактическим rect
 *  узлов, единственная вертикаль у единственного ребёнка, деление на масштаб
 *  канваса. jsdom без ResizeObserver и layout — rects и observer заглушены. */

function elementWithRect(left: number, top: number, width: number, height: number) {
  const element = document.createElement('div');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
  return element;
}

const links: TreeLink[] = [
  { parent: 'a', child: 'b' },
  { parent: 'a', child: 'c' },
];

function setup(scale = 1) {
  const root = elementWithRect(0, 0, 1000, 800);
  const nodes = new Map([
    ['a', elementWithRect(400, 100, 240, 260)], // центр 520, низ 360
    ['b', elementWithRect(300, 620, 240, 260)], // центр 420
    ['c', elementWithRect(600, 620, 240, 260)], // центр 720
  ]);
  return renderHook(() => useTreeEdges({ current: root }, { current: nodes }, links, scale));
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useTreeEdges (#768)', () => {
  it('группа из двух детей: шина, ствол и отводы с портами', () => {
    const { result } = setup();
    const ds = result.current.segments.map((segment) => segment.d);
    // snapPx при dpr=1 даёт полупиксельные координаты (чёткий hairline).
    expect(ds).toContain('M 520.5 360 V 490.5'); // ствол до шины (середина зазора)
    expect(ds).toContain('M 420.5 490.5 H 720.5'); // шина от первого до последнего
    expect(ds).toContain('M 420.5 490.5 V 616');
    expect(ds).toContain('M 720.5 490.5 V 616');
    expect(result.current.ports).toEqual([
      { key: 'port-b', x: 420.5, y: 619 },
      { key: 'port-c', x: 720.5, y: 619 },
    ]);
    expect(result.current.portRadius).toBe(3);
    const route = result.current.routes.find((item) => item.child === 'b');
    expect(route?.d).toBe('M 520.5 360 V 490.5 H 420.5 V 616');
    expect(route?.length).toBe(356);
  });

  it('единственный ребёнок ровно под узлом — одна вертикаль без шины', () => {
    const root = elementWithRect(0, 0, 1000, 800);
    const nodes = new Map([
      ['a', elementWithRect(400, 100, 240, 260)],
      ['b', elementWithRect(400, 620, 240, 260)],
    ]);
    const { result } = renderHook(() =>
      useTreeEdges({ current: root }, { current: nodes }, [{ parent: 'a', child: 'b' }], 1),
    );
    expect(result.current.segments).toEqual([{ key: 'trunk-a', d: 'M 520.5 360 V 616' }]);
    expect(result.current.routes).toEqual([
      { parent: 'a', child: 'b', d: 'M 520.5 360 V 616', length: 256 },
    ]);
  });

  it('масштаб канваса: экранные rect делятся на зум', () => {
    const { result } = setup(2);
    const ds = result.current.segments.map((segment) => segment.d);
    expect(ds).toContain('M 260.5 180 V 245.5');
    expect(result.current.ports).toEqual([
      { key: 'port-b', x: 210.5, y: 309 },
      { key: 'port-c', x: 360.5, y: 309 },
    ]);
  });

  it('оптимистичная вставка: temp-id заменяется реальным при той же геометрии', () => {
    // Регрессия #768: сравнение только по `d` оставляло в портах/маршрутах
    // ключи `temp-…`, и StructureTrace не находил ребро (след исчезал).
    const root = elementWithRect(0, 0, 1000, 800);
    const nodes = new Map([
      ['a', elementWithRect(400, 100, 240, 260)],
      ['temp-1', elementWithRect(400, 620, 240, 260)],
    ]);
    const { result, rerender } = renderHook(
      ({ links: current }: { links: TreeLink[] }) =>
        useTreeEdges({ current: root }, { current: nodes }, current, 1),
      { initialProps: { links: [{ parent: 'a', child: 'temp-1' }] as TreeLink[] } },
    );
    expect(result.current.ports).toEqual([{ key: 'port-temp-1', x: 520.5, y: 619 }]);

    nodes.delete('temp-1');
    nodes.set('real-1', elementWithRect(400, 620, 240, 260));
    rerender({ links: [{ parent: 'a', child: 'real-1' }] });

    expect(result.current.segments).toEqual([{ key: 'trunk-a', d: 'M 520.5 360 V 616' }]);
    expect(result.current.ports).toEqual([{ key: 'port-real-1', x: 520.5, y: 619 }]);
    expect(result.current.routes).toEqual([
      { parent: 'a', child: 'real-1', d: 'M 520.5 360 V 616', length: 256 },
    ]);
  });
});
