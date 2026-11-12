import { describe, expect, it } from 'vitest';

import { FLIP_MIN_DELTA_PX, flipDelta } from './board-flip.js';

/**
 * #737: FLIP-анимация живой перестановки — сдвиг «старое место → новое».
 * Место вставки FLIP не выбирает (это делает kanban-drop-index), поэтому
 * инверсия стороны из анимации невозможна — тест фиксирует только геометрию.
 */

describe('flipDelta — сдвиг для FLIP-анимации', () => {
  it('карточка уехала вниз на высоту соседа → сдвиг от старого места', () => {
    expect(flipDelta({ top: 0, left: 0 }, { top: 120, left: 0 })).toEqual({ dx: 0, dy: -120 });
  });

  it('карточка уехала вверх → обратный знак сдвига', () => {
    expect(flipDelta({ top: 120, left: 0 }, { top: 0, left: 0 })).toEqual({ dx: 0, dy: 120 });
  });

  it('горизонтальный переезд между колонками — дельта по X', () => {
    expect(flipDelta({ top: 10, left: 0 }, { top: 10, left: 260 })).toEqual({ dx: -260, dy: 0 });
  });

  it('субпиксельные колебания раскладки — не движение (null)', () => {
    expect(flipDelta({ top: 10, left: 10 }, { top: 10.5, left: 10.4 })).toBeNull();
  });

  it('порог: ровно 1px — уже движение', () => {
    expect(flipDelta({ top: 0, left: 0 }, { top: FLIP_MIN_DELTA_PX, left: 0 })).toEqual({
      dx: 0,
      dy: -FLIP_MIN_DELTA_PX,
    });
  });
});
