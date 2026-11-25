import { describe, expect, it } from 'vitest';

import {
  EDGE_MAX_SPEED,
  EDGE_MIN_SPEED,
  EDGE_ZONE_PX,
  edgeHit,
  edgeSpeed,
  scrollRoom,
} from './edge-scroll.js';

const bounds = { left: 100, right: 1100 };
const both = { left: true, right: true };

describe('scrollRoom', () => {
  it('в начале доски листать можно только вправо', () => {
    expect(scrollRoom(0, 1000, 2000)).toEqual({ left: false, right: true });
  });
  it('в конце — только влево (дробный scrollLeft при --ui-scale)', () => {
    expect(scrollRoom(999.6, 1000, 2000)).toEqual({ left: true, right: false });
  });
  it('доска помещается целиком — зон нет', () => {
    expect(scrollRoom(0, 1000, 1000)).toEqual({ left: false, right: false });
  });
});

describe('edgeHit', () => {
  it('у правой кромки — правая зона на полной глубине', () => {
    expect(edgeHit(1100, bounds, both)).toEqual({ side: 'right', depth: 1 });
  });
  it('у внутренней границы левой зоны — глубина около нуля', () => {
    const hit = edgeHit(100 + EDGE_ZONE_PX - 1, bounds, both);
    expect(hit?.side).toBe('left');
    expect(hit?.depth).toBeCloseTo(1 / EDGE_ZONE_PX);
  });
  it('середина доски — мимо зон', () => {
    expect(edgeHit(600, bounds, both)).toBeNull();
  });
  it('в сторону без места зона не работает (конец доски не мешает крайней колонке)', () => {
    expect(edgeHit(1090, bounds, { left: true, right: false })).toBeNull();
    expect(edgeHit(110, bounds, { left: false, right: true })).toBeNull();
  });
  it('курсор за пределами доски — не зона', () => {
    expect(edgeHit(1101, bounds, both)).toBeNull();
    expect(edgeHit(99, bounds, both)).toBeNull();
  });
  it('узкая доска: зона не шире четверти ширины', () => {
    const narrow = { left: 0, right: 120 };
    expect(edgeHit(31, narrow, both)).toBeNull();
    expect(edgeHit(29, narrow, both)?.side).toBe('left');
  });
  it('закреплённая колонка слева: зона начинается правее неё (insetLeft, #1006)', () => {
    // Отступ 200: 100..300 — над неподвижной колонкой, зона — 300..348.
    expect(edgeHit(150, bounds, both, EDGE_ZONE_PX, 200)).toBeNull();
    expect(edgeHit(310, bounds, both, EDGE_ZONE_PX, 200)?.side).toBe('left');
    expect(edgeHit(330, bounds, both, EDGE_ZONE_PX, 200)?.depth).toBeCloseTo(1 - 30 / EDGE_ZONE_PX);
    // Правая кромка от левого отступа не зависит.
    expect(edgeHit(1100, bounds, both, EDGE_ZONE_PX, 200)).toEqual({ side: 'right', depth: 1 });
  });
  it('отступ съел всю ширину — левой зоны нет', () => {
    expect(edgeHit(150, bounds, both, EDGE_ZONE_PX, 1000)).toBeNull();
  });
});

describe('edgeSpeed', () => {
  it('разгон от минимума к максимуму, за пределами — кламп', () => {
    expect(edgeSpeed(0)).toBe(EDGE_MIN_SPEED);
    expect(edgeSpeed(1)).toBe(EDGE_MAX_SPEED);
    expect(edgeSpeed(2)).toBe(EDGE_MAX_SPEED);
    expect(edgeSpeed(0.5)).toBeLessThan((EDGE_MIN_SPEED + EDGE_MAX_SPEED) / 2);
  });
});
