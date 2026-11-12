import { describe, expect, it } from 'vitest';
import { verticalListSortingStrategy } from '@dnd-kit/sortable';

import { liveBoardSortingStrategy } from './board-sorting.js';

/**
 * #737 (репро 13.11.2026): живой порядок борда уже содержит перестановку —
 * стратегия сортировки НЕ должна двигать карточки трансформами, иначе dnd-kit
 * разворачивает сторону вставки. Тест-инвариант: для сценария, где штатная
 * verticalListSortingStrategy выдаёт сдвиги (и визуально меняет сторону),
 * наша стратегия возвращает null на каждой позиции.
 */

/** Колонка из двух карточек: [B, A], активная A — состояние «вставка после B». */
const rect = (top: number): ClientRect => ({
  top,
  bottom: top + 100,
  height: 100,
  left: 0,
  right: 200,
  width: 200,
  x: 0,
  y: top,
  toJSON: () => ({}),
});
const LIVE_REORDER = {
  activeIndex: 1,
  overIndex: 0,
  rects: [rect(0), rect(100)],
  activeNodeRect: rect(100),
};

describe('liveBoardSortingStrategy — нейтральна к живому порядку', () => {
  it('не двигает ни одну карточку: любая позиция — null', () => {
    for (const index of [0, 1, 2] as const) {
      expect(liveBoardSortingStrategy({ ...LIVE_REORDER, index })).toBeNull();
    }
  });

  it('штатная стратегия в этом же сценарии двигает карточки — механизм бага зафиксирован', () => {
    const shipped = [0, 1].map((index) => verticalListSortingStrategy({ ...LIVE_REORDER, index }));
    expect(shipped.every((transform) => transform !== null)).toBe(true);
  });
});
