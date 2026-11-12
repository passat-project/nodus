import { describe, expect, it } from 'vitest';

import { ROW_MAIN_MIN_W, chatCeiling } from './branch-panel.js';

describe('chatCeiling — потолок чата карточки сотрудника (#750)', () => {
  it('ряд минус стоящая панель минус минимум профиля', () => {
    expect(chatCeiling(1600, 300)).toBe(1600 - 300 - ROW_MAIN_MIN_W);
    expect(chatCeiling(1600, 0)).toBe(1600 - ROW_MAIN_MIN_W);
  });

  it('во время анимации панели потолок считается от РЯДА, а не сетки', () => {
    // Ряд карточки не движется, пока панель выезжает: цель перехода ширины
    // чата одна на весь кадр анимации — профиль не раздувается и возвращается.
    const row = 1600;
    expect(chatCeiling(row, 300)).toBe(chatCeiling(row, 300));
    // Потолок панели открытой и закрытой отличается ровно на ширину панели.
    expect(chatCeiling(row, 300) + 300).toBe(chatCeiling(row, 0));
  });

  it('ряд ещё не измерен — потолка нет', () => {
    expect(chatCeiling(0, 300)).toBe(Number.POSITIVE_INFINITY);
  });

  it('минимум соседней зоны настраивается (общая геометрия ряда)', () => {
    expect(chatCeiling(1000, 200, 280)).toBe(520);
  });
});
