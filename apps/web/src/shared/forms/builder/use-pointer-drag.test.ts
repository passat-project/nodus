import { describe, expect, it } from 'vitest';

import { dropTarget, type DropRect } from './use-pointer-drag.js';

/** Место вставки под указателем (#496, Р2): строки на всю ширину решает
 *  вертикаль, пару половин — горизонталь. */

const rect = (
  index: number,
  top: number,
  left: number,
  width: number,
  paired = false,
): DropRect => ({
  index,
  paired,
  top,
  left,
  width,
  height: 40,
});

describe('редактор окна: место вставки', () => {
  // Строка 0: «Получатель» на всю ширину; строка 1: «Вид выдачи» | «Версия».
  const rects = [rect(0, 0, 0, 400), rect(1, 60, 0, 190, true), rect(2, 60, 210, 190, true)];

  it('выше середины строки — перед ней, ниже — после', () => {
    expect(dropTarget(rects, 100, 10)).toBe(0);
    expect(dropTarget(rects, 100, 30)).toBe(1);
  });

  it('в паре половин — по горизонтали: левее середины, между, правее', () => {
    expect(dropTarget(rects, 50, 80)).toBe(1);
    expect(dropTarget(rects, 250, 80)).toBe(2);
    expect(dropTarget(rects, 380, 80)).toBe(3);
  });

  it('ниже всех — в конец; пустой список — 0', () => {
    expect(dropTarget(rects, 100, 500)).toBe(3);
    expect(dropTarget([], 0, 0)).toBe(0);
  });
});
