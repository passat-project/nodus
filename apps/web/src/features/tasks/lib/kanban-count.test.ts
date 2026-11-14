import { describe, expect, it } from 'vitest';

import { bumpCountDelta } from './kanban-count.js';

describe('bumpCountDelta', () => {
  it('межколоночный перенос: цель +1, источник -1', () => {
    expect(bumpCountDelta({ a: 2, b: 3 }, 'a', 'b', 1)).toEqual({ a: 1, b: 4 });
  });

  it('перестановка внутри колонки не трогает счётчик', () => {
    const prev = { a: 2, b: 3 };
    expect(bumpCountDelta(prev, 'a', 'a', 1)).toBe(prev);
    expect(bumpCountDelta(prev, 'a', 'a', -1)).toBe(prev);
  });

  it('откат межколоночного переноса возвращает исходные значения', () => {
    const prev = { a: 1, b: 4 };
    expect(bumpCountDelta(prev, 'a', 'b', -1)).toEqual({ a: 2, b: 3 });
  });
});
