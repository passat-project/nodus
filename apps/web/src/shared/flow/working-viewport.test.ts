import { describe, expect, it } from 'vitest';

import {
  CANVAS_MIN_ZOOM,
  FIT,
  WORK_INSET,
  WORK_ZOOM_FLOOR,
  measuredBounds,
  workingViewport,
  type MeasuredNodeLike,
} from './working-viewport.js';

/** Холст «Маршрута» при окне 1600. */
const CANVAS = { width: 830, height: 714 } as const;

/** Формула вписывания движка (padding, min/max) — чтобы вход `fit` был настоящим. */
function fitOf(bounds: { x: number; y: number; width: number; height: number }) {
  const zoom = Math.min(
    CANVAS.width / (bounds.width * (1 + FIT.padding)),
    CANVAS.height / (bounds.height * (1 + FIT.padding)),
  );
  const clamped = Math.min(Math.max(zoom, CANVAS_MIN_ZOOM), FIT.maxZoom);
  return {
    zoom: clamped,
    x: CANVAS.width / 2 - (bounds.x + bounds.width / 2) * clamped,
    y: CANVAS.height / 2 - (bounds.y + bounds.height / 2) * clamped,
  };
}

describe('рабочий масштаб графа: правило вписывания (#857, Д2)', () => {
  it('граф влезает в рабочий масштаб — весь по центру, как вписывание', () => {
    const bounds = { x: 100, y: 200, width: 800, height: 300 };
    const fit = fitOf(bounds);
    expect(fit.zoom).toBeGreaterThan(WORK_ZOOM_FLOOR);
    expect(workingViewport(fit, bounds, CANVAS.width, CANVAS.height)).toBe(fit);
  });

  it('граф шире холста — рабочий масштаб и НАЧАЛОМ: левый край на отступе, старт виден', () => {
    const bounds = { x: 120, y: 260, width: 1745, height: 150 };
    const fit = fitOf(bounds);
    expect(fit.zoom.toFixed(2)).toBe('0.40');
    const view = workingViewport(fit, bounds, CANVAS.width, CANVAS.height);
    expect(view.zoom).toBe(WORK_ZOOM_FLOOR);
    // Левый край самого левого узла — в `WORK_INSET` от края холста.
    expect(bounds.x * view.zoom + view.x).toBeCloseTo(WORK_INSET, 6);
    // По вертикали — по центру.
    const graphHeight = bounds.height * view.zoom;
    expect(bounds.y * view.zoom + view.y).toBeCloseTo((CANVAS.height - graphHeight) / 2, 6);
    // Конец уходит за край холста — это рабочий вид, целиком граф показывает «Вписать».
    expect((bounds.x + bounds.width) * view.zoom + view.x).toBeGreaterThan(CANVAS.width);
  });

  it('рабочий вид: граф шире холста — отступ слева ровно 32 px при любой ширине холста', () => {
    expect(WORK_INSET).toBe(32);
    const bounds = { x: 120, y: 260, width: 1745, height: 150 };
    // Обе ширины уже графа в рабочем масштабе (1047 px) — иначе он встал бы по центру.
    for (const width of [CANVAS.width, 1024]) {
      const view = workingViewport(fitOf(bounds), bounds, width, CANVAS.height);
      expect(bounds.x * view.zoom + view.x).toBe(WORK_INSET);
    }
  });

  it('граф выше холста и не шире холста — по горизонтали по центру, сверху на отступе', () => {
    const bounds = { x: 0, y: 40, width: 700, height: 1400 };
    const view = workingViewport(fitOf(bounds), bounds, CANVAS.width, CANVAS.height);
    expect(view.zoom).toBe(WORK_ZOOM_FLOOR);
    // По горизонтали граф влезает — по центру.
    const graphWidth = bounds.width * view.zoom;
    expect(bounds.x * view.zoom + view.x).toBeCloseTo((CANVAS.width - graphWidth) / 2, 6);
    // По вертикали не влезает — верхним краем в `WORK_INSET` от верха.
    expect(bounds.y * view.zoom + view.y).toBeCloseTo(WORK_INSET, 6);
  });

  it('граф выше холста и шире холста — на отступе слева и сверху', () => {
    const bounds = { x: 120, y: 40, width: 1745, height: 1400 };
    const view = workingViewport(fitOf(bounds), bounds, CANVAS.width, CANVAS.height);
    expect(view.zoom).toBe(WORK_ZOOM_FLOOR);
    expect(bounds.x * view.zoom + view.x).toBeCloseTo(WORK_INSET, 6);
    expect(bounds.y * view.zoom + view.y).toBeCloseTo(WORK_INSET, 6);
  });

  it('ровно рабочий масштаб — целиком по центру: порог не строго больше', () => {
    const fit = { zoom: WORK_ZOOM_FLOOR, x: 10, y: 20 };
    expect(workingViewport(fit, { x: 0, y: 0, width: 1, height: 1 }, 830, 714)).toBe(fit);
  });
});

describe('границы графа из стора движка (#857, Д1)', () => {
  /** Узел графа — тот самый объект, что уходит в свойство `nodes` движка. */
  const a = { id: 'a', position: { x: 100, y: 260 } };
  const b = { id: 'b', position: { x: 400, y: 200 } };
  const graph = [a, b];
  /** Запись в сторе движка: принята с объектом `owner`, позиция и размер. */
  const entry = (
    owner: { position: { x: number; y: number } },
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): MeasuredNodeLike => ({
    measured: { width, height },
    internals: { positionAbsolute: { x, y }, userNode: owner },
  });
  const settled = () =>
    new Map([
      ['a', entry(a, 100, 260, 208, 52)],
      ['b', entry(b, 400, 200, 120, 80)],
    ]);

  it('стор принял этот граф и измерил его — прямоугольник по крайним узлам', () => {
    expect(measuredBounds(graph, settled())).toEqual({ x: 100, y: 200, width: 420, height: 112 });
  });

  it('в сторе ещё прежний граф (смена типа) — не вписываем', () => {
    const old = { id: 'old', position: { x: 5, y: 5 } };
    const oldA = { id: 'a', position: { x: 5, y: 5 } };
    const stale = new Map([
      ['a', entry(oldA, 5, 5, 1, 1)],
      ['old', entry(old, 5, 5, 1, 1)],
    ]);
    expect(measuredBounds(graph, stale)).toBeNull();
    stale.delete('a');
    expect(measuredBounds(graph, stale)).toBeNull();
  });

  it('те же узлы со СТАРЫМИ позициями (после «Упорядочить») — ждём, пока стор примет новые объекты', () => {
    const before = [
      { ...a, position: { x: 900, y: 900 } },
      { ...b, position: { x: 1200, y: 900 } },
    ];
    expect(measuredBounds(before, settled())).toBeNull();
  });

  it('узел графа ещё не измерен — ждём, часть графа не вписываем', () => {
    const lookup = settled();
    lookup.set('b', entry(b, 400, 200));
    expect(measuredBounds(graph, lookup)).toBeNull();
  });

  it('скрытые узлы в границах не участвуют', () => {
    const lookup = settled();
    lookup.set('b', { ...entry(b, 999, 999, 50, 50), hidden: true });
    expect(measuredBounds(graph, lookup)).toEqual({ x: 100, y: 260, width: 208, height: 52 });
  });
});
