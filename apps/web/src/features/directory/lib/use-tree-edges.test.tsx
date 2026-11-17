// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

import { uiPx } from '../../../shared/ui/ui-scale.js';
import { elbowLength } from './tree-edge-geometry.js';
import { useTreeEdges, type TreeLink } from './use-tree-edges.js';

/** Геометрия рёбер структуры (#768): шина/ствол/отводы по фактическим rect
 *  узлов, единственная вертикаль у единственного ребёнка, деление на масштаб
 *  канваса, слияние ствола с шиной двумя радиусами (тройника нет) и единый
 *  радиус локтя. jsdom без ResizeObserver и layout — rects и observer заглушены.
 *  Радиусы — дизайн-px через uiPx: та же шкала, что у карточек. */

/** Единый радиус локтя из `tree-edge-geometry.ts` — 8 дизайн-px. */
const ELBOW = uiPx(8);
/** Длина дуги локтя: импульс считает скорость по ней, а не по хорде. */
const ARC = elbowLength(ELBOW);

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
  it('дети с обеих сторон: ствол сливается с шиной двумя дугами, отводы с локтями', () => {
    const { result } = setup();
    const ds = result.current.segments.map((segment) => segment.d);
    // snapPx при dpr=1 даёт полупиксельные координаты (чёткий hairline).
    expect(ds).toContain(`M 520.5 360 V ${490.5 - ELBOW}`); // ствол до вершины дуг
    // Шина рвётся под стволом: половины заворачивают ВВЕРХ дугами к вершине.
    expect(ds).toContain(
      `M ${420.5 + ELBOW} 490.5 H ${520.5 - ELBOW} Q 520.5 490.5 520.5 ${490.5 - ELBOW}`,
    );
    expect(ds).toContain(
      `M 520.5 ${490.5 - ELBOW} Q 520.5 490.5 ${520.5 + ELBOW} 490.5 H ${720.5 - ELBOW}`,
    );
    // Отводы — дуга со стороны ствола и вертикаль до порта.
    expect(ds).toContain(
      `M ${420.5 + ELBOW} 490.5 Q 420.5 490.5 420.5 ${490.5 + ELBOW} L 420.5 616`,
    );
    expect(ds).toContain(
      `M ${720.5 - ELBOW} 490.5 Q 720.5 490.5 720.5 ${490.5 + ELBOW} L 720.5 616`,
    );
    expect(result.current.ports).toEqual([
      { key: 'port-b', x: 420.5, y: 619 },
      { key: 'port-c', x: 720.5, y: 619 },
    ]);
    expect(result.current.portRadius).toBe(3);
  });

  it('маршрут импульса идёт по той же линии слияния и дугам отводов', () => {
    const { result } = setup();
    const route = result.current.routes.find((item) => item.child === 'b');
    expect(route?.d).toBe(
      [
        'M 520.5 360',
        `V ${490.5 - ELBOW}`,
        `Q 520.5 490.5 ${520.5 - ELBOW} 490.5`,
        `H ${420.5 + ELBOW}`,
        `Q 420.5 490.5 420.5 ${490.5 + ELBOW}`,
        'V 616',
      ].join(' '),
    );
    // Длина: ствол до вершины + дуга слияния + левая половина шины + дуга
    // отвода + вертикаль до порта.
    expect(route?.length).toBeCloseTo(
      130.5 - ELBOW + ARC + (100 - 2 * ELBOW) + ARC + (125.5 - ELBOW),
      6,
    );
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

  it('все дети с одной стороны — ствол поворачивает в шину одним локтём', () => {
    const root = elementWithRect(0, 0, 1000, 800);
    const nodes = new Map([
      ['a', elementWithRect(400, 100, 240, 260)],
      ['b', elementWithRect(600, 620, 240, 260)],
    ]);
    const { result } = renderHook(() =>
      useTreeEdges({ current: root }, { current: nodes }, [{ parent: 'a', child: 'b' }], 1),
    );
    const ds = result.current.segments.map((segment) => segment.d);
    expect(ds).toContain(
      `M ${520.5 + ELBOW} 490.5 Q 520.5 490.5 520.5 ${490.5 - ELBOW} L 520.5 360`,
    );
    expect(ds).toContain(`M ${520.5 + ELBOW} 490.5 H ${720.5 - ELBOW}`);
    expect(ds).toContain(
      `M ${720.5 - ELBOW} 490.5 Q 720.5 490.5 720.5 ${490.5 + ELBOW} L 720.5 616`,
    );
    const route = result.current.routes.find((item) => item.child === 'b');
    expect(route?.length).toBeCloseTo(456 - 4 * ELBOW + 2 * ARC, 6);
  });

  it('нечётное число детей: вертикаль продолжается в центральную карточку', () => {
    const root = elementWithRect(0, 0, 1000, 800);
    const nodes = new Map([
      ['a', elementWithRect(400, 100, 240, 260)], // центр 520
      ['b', elementWithRect(180, 620, 240, 260)], // центр 300
      ['m', elementWithRect(400, 620, 240, 260)], // центр 520 — под стволом
      ['c', elementWithRect(600, 620, 240, 260)], // центр 720
    ]);
    const { result } = renderHook(() =>
      useTreeEdges(
        { current: root },
        { current: nodes },
        [
          { parent: 'a', child: 'b' },
          { parent: 'a', child: 'm' },
          { parent: 'a', child: 'c' },
        ],
        1,
      ),
    );
    const ds = result.current.segments.map((segment) => segment.d);
    // Ствол и отвод центрального ребёнка — одна сквозная вертикаль.
    expect(ds).toContain('M 520.5 360 V 616');
    expect(ds).toContain(
      `M ${300.5 + ELBOW} 490.5 H ${520.5 - ELBOW} Q 520.5 490.5 520.5 ${490.5 - ELBOW}`,
    );
    expect(ds).toContain(
      `M 520.5 ${490.5 - ELBOW} Q 520.5 490.5 ${520.5 + ELBOW} 490.5 H ${720.5 - ELBOW}`,
    );
    expect(result.current.ports).toEqual([
      { key: 'port-b', x: 300.5, y: 619 },
      { key: 'port-m', x: 520.5, y: 619 },
      { key: 'port-c', x: 720.5, y: 619 },
    ]);
    const route = result.current.routes.find((item) => item.child === 'm');
    expect(route?.d).toBe('M 520.5 360 V 616');
    expect(route?.length).toBe(256);
  });

  it('масштаб канваса: экранные rect делятся на зум, снап — по экранной сетке', () => {
    const { result } = setup(2);
    const ds = result.current.segments.map((segment) => segment.d);
    // 260 на полотне при зуме 2 → 520.5 px экрана → 260.25 на полотне.
    expect(ds).toContain(`M 260.25 180 V ${245.25 - ELBOW}`);
    expect(result.current.ports).toEqual([
      { key: 'port-b', x: 210.25, y: 309 },
      { key: 'port-c', x: 360.25, y: 309 },
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
