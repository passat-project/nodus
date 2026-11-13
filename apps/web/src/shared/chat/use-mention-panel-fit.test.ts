// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  mentionPanelStyle,
  placeMentionPanel,
  scrollActiveMentionIntoView,
} from './use-mention-panel-fit.js';

/** Геометрия панели @упоминаний (#844): одна логика для композера и окна
 *  вложений — 9 рядов (360px), скролл дальше; место по вьюпорту
 *  (flip/size/shift), без клипа контейнера. */
describe('placeMentionPanel (#844)', () => {
  const viewport = { width: 1600, height: 1000 };

  it('место есть сверху — панель над полем, полные 360px (9 рядов)', () => {
    const placement = placeMentionPanel({ top: 700, bottom: 760, left: 600, width: 520 }, viewport);
    expect(placement).toMatchObject({ side: 'above', maxHeight: 360, left: 600, width: 420 });
    // Низ панели — над полем с зазором 6px: 1000 - 700 + 6.
    expect(placement.bottom).toBe(306);
  });

  it('сверху тесно, снизу просторнее — панель уезжает вниз', () => {
    const placement = placeMentionPanel({ top: 90, bottom: 150, left: 40, width: 400 }, viewport);
    expect(placement).toMatchObject({ side: 'below', maxHeight: 360, top: 156 });
  });

  it('сверху мало, но снизу ещё меньше — остаётся сверху и скроллится', () => {
    const placement = placeMentionPanel(
      { top: 260, bottom: 320, left: 40, width: 400 },
      { width: 1600, height: 400 },
    );
    // 260-8-6 = 246 сверху против 400-320-8-6 = 66 снизу.
    expect(placement).toMatchObject({ side: 'above', maxHeight: 246 });
  });

  it('ширина прижата к полю и к кромкам вьюпорта (shift, отступ 8px)', () => {
    const narrow = placeMentionPanel(
      { top: 700, bottom: 760, left: 900, width: 900 },
      { width: 1000, height: 1000 },
    );
    expect(narrow.width).toBe(420);
    // 1000 - 420 - 8 = 572: правый край не выходит за кромку.
    expect(narrow.left).toBe(572);
    const edge = placeMentionPanel({ top: 700, bottom: 760, left: 0, width: 600 }, viewport);
    expect(edge.left).toBe(8);
  });

  it('активный ряд подскролливается: ↑/↓ с заворотом не уводят выбор за край', () => {
    const make = (optionRect: { top: number; bottom: number }) => {
      const list = document.createElement('div');
      const option = document.createElement('span');
      option.setAttribute('role', 'option');
      list.append(option);
      list.getBoundingClientRect = () => ({ top: 100, bottom: 220 }) as DOMRect;
      option.getBoundingClientRect = () => optionRect as DOMRect;
      return { list, option };
    };

    // Ряд ниже окна списка — панель прокручивается вниз на разницу.
    const below = make({ top: 230, bottom: 270 });
    scrollActiveMentionIntoView(below.list, 0);
    expect(below.list.scrollTop).toBe(50);

    // Ряд выше окна — прокрутка вверх на разницу от текущей позиции.
    const above = make({ top: 60, bottom: 100 });
    above.list.scrollTop = 80;
    scrollActiveMentionIntoView(above.list, 0);
    expect(above.list.scrollTop).toBe(40);
  });

  it('стиль фиксирует панель до первого замера и возвращает pointer-events (модал Radix)', () => {
    expect(mentionPanelStyle(null)).toMatchObject({
      position: 'fixed',
      pointerEvents: 'auto',
      visibility: 'hidden',
    });
    expect(
      mentionPanelStyle({ side: 'above', left: 10, width: 300, maxHeight: 360, bottom: 250 }),
    ).toMatchObject({
      position: 'fixed',
      pointerEvents: 'auto',
      left: 10,
      width: 300,
      maxHeight: 360,
      bottom: 250,
    });
  });
});
