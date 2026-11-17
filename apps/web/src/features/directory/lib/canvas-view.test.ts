import { describe, expect, it } from 'vitest';

import {
  INITIAL_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  centerAtPoint,
  clampZoom,
  fitZoom,
  panBy,
  wheelZoomAt,
  zoomAtPoint,
} from './canvas-view.js';

/** Математика канваса структуры (#768): пределы, зум к курсору, панорама,
 *  вписывание — чистые функции без DOM. */

describe('canvas-view (#768)', () => {
  it('масштаб ограничен 30–200%, мусор — 100%', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1.2)).toBe(1.2);
  });

  it('зум держит точку под курсором неподвижной', () => {
    const point = { x: 300, y: 200 };
    const view = { x: 40, y: -25, zoom: 1 };
    const before = {
      x: (point.x - view.x) / view.zoom,
      y: (point.y - view.y) / view.zoom,
    };
    const next = zoomAtPoint(view, 1.5, point);
    expect((point.x - next.x) / next.zoom).toBeCloseTo(before.x, 6);
    expect((point.y - next.y) / next.zoom).toBeCloseTo(before.y, 6);
    expect(next.zoom).toBe(1.5);
  });

  it('Ctrl+колесо: вверх — приближение, вниз — отдаление', () => {
    const point = { x: 100, y: 100 };
    expect(wheelZoomAt(INITIAL_VIEW, -200, point).zoom).toBeGreaterThan(1);
    expect(wheelZoomAt(INITIAL_VIEW, 200, point).zoom).toBeLessThan(1);
    expect(wheelZoomAt(INITIAL_VIEW, -100000, point).zoom).toBe(MAX_ZOOM);
    expect(wheelZoomAt(INITIAL_VIEW, 100000, point).zoom).toBe(MIN_ZOOM);
  });

  it('панорама сдвигает полотно', () => {
    expect(panBy({ x: 10, y: 20, zoom: 1 }, -5, 7)).toEqual({ x: 5, y: 27, zoom: 1 });
  });

  it('«показать целиком» не раздувает мелкую структуру', () => {
    expect(fitZoom({ width: 400, height: 200 }, { width: 1000, height: 600 })).toBe(1);
    expect(fitZoom({ width: 2000, height: 400 }, { width: 1000, height: 600 })).toBeCloseTo(0.5);
    expect(fitZoom({ width: 0, height: 0 }, { width: 1000, height: 600 })).toBe(1);
  });

  it('центрирование ставит цель в центр свободной области', () => {
    const view = { x: 0, y: 0, zoom: 1 };
    const next = centerAtPoint(view, { x: 900, y: 100 }, { width: 800, height: 600 });
    expect(next.x).toBe(-500);
    expect(next.y).toBe(200);
  });
});
