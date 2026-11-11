import { describe, expect, it } from 'vitest';

import { activatorPointerY, computeInsertIndex, dropAnchorY } from './kanban-drop-index.js';

/**
 * #737: индекс вставки канбана считается по позиции УКАЗАТЕЛЯ на каждом
 * движении — в колонке из одной карточки доступны «над/под», из двух —
 * «между», из N — любая из N+1 позиций; сторона переключается живьём при
 * пересечении середины целевой карточки. Семантика индекса — среди ОСТАЛЬНЫХ
 * карточек колонки (как у серверного `index`: активная вынута).
 */

/** Целевая карточка: верх 100, высота 100 → середина 150. */
const OVER = { overTop: 100, overHeight: 100 };

describe('computeInsertIndex: колонка из ОДНОЙ карточки — «над/под»', () => {
  it('указатель выше середины цели → перед ней (0)', () => {
    expect(
      computeInsertIndex({ anchorY: 120, overIndex: 0, activeIndex: -1, restCount: 1, ...OVER }),
    ).toBe(0);
  });

  it('указатель ниже середины цели → после неё (1)', () => {
    expect(
      computeInsertIndex({ anchorY: 180, overIndex: 0, activeIndex: -1, restCount: 1, ...OVER }),
    ).toBe(1);
  });

  it('ровно середина — «над» (граница не переключается дрожанием)', () => {
    expect(
      computeInsertIndex({ anchorY: 150, overIndex: 0, activeIndex: -1, restCount: 1, ...OVER }),
    ).toBe(0);
  });

  it('переключение живьём: два расчёта на разных Y дают разные стороны', () => {
    const above = computeInsertIndex({
      anchorY: 140,
      overIndex: 0,
      activeIndex: -1,
      restCount: 1,
      ...OVER,
    });
    const below = computeInsertIndex({
      anchorY: 160,
      overIndex: 0,
      activeIndex: -1,
      restCount: 1,
      ...OVER,
    });
    expect([above, below]).toEqual([0, 1]);
  });
});

describe('computeInsertIndex: колонка из ДВУХ карточек — «между» доступно', () => {
  it('над первой → 0', () => {
    expect(
      computeInsertIndex({ anchorY: 110, overIndex: 0, activeIndex: -1, restCount: 2, ...OVER }),
    ).toBe(0);
  });

  it('под первой (над второй) → 1 — между карточками', () => {
    expect(
      computeInsertIndex({ anchorY: 190, overIndex: 0, activeIndex: -1, restCount: 2, ...OVER }),
    ).toBe(1);
  });

  it('под второй → 2 — в конец', () => {
    expect(
      computeInsertIndex({ anchorY: 290, overIndex: 1, activeIndex: -1, restCount: 2, ...OVER }),
    ).toBe(2);
  });
});

describe('computeInsertIndex: внутриколоночная перестановка (активная уже в колонке)', () => {
  it('активная перед целью: индекс цели сдвигается на её вынимание — 0/1', () => {
    const above = computeInsertIndex({
      anchorY: 120,
      overIndex: 1,
      activeIndex: 0,
      restCount: 1,
      ...OVER,
    });
    const below = computeInsertIndex({
      anchorY: 180,
      overIndex: 1,
      activeIndex: 0,
      restCount: 1,
      ...OVER,
    });
    expect([above, below]).toEqual([0, 1]);
  });

  it('активная после цели: индекс цели не сдвигается — 0/1', () => {
    const above = computeInsertIndex({
      anchorY: 120,
      overIndex: 0,
      activeIndex: 1,
      restCount: 1,
      ...OVER,
    });
    const below = computeInsertIndex({
      anchorY: 180,
      overIndex: 0,
      activeIndex: 1,
      restCount: 1,
      ...OVER,
    });
    expect([above, below]).toEqual([0, 1]);
  });

  it('цель — сама активная или геометрии нет: борд не трогаем (-1)', () => {
    expect(
      computeInsertIndex({ anchorY: 180, overIndex: 1, activeIndex: 1, restCount: 2, ...OVER }),
    ).toBe(-1);
    expect(
      computeInsertIndex({ anchorY: null, overIndex: 1, activeIndex: -1, restCount: 2, ...OVER }),
    ).toBe(-1);
  });
});

describe('computeInsertIndex: over — колонка (пустая или фон)', () => {
  it('пустая колонка → 0 (единственная позиция)', () => {
    expect(
      computeInsertIndex({
        anchorY: null,
        overIndex: -1,
        activeIndex: -1,
        restCount: 0,
        ...OVER,
      }),
    ).toBe(0);
  });

  it('колонка без карточки-цели → в конец остальных', () => {
    expect(
      computeInsertIndex({
        anchorY: 500,
        overIndex: -1,
        activeIndex: -1,
        restCount: 4,
        ...OVER,
      }),
    ).toBe(4);
  });
});

describe('dropAnchorY: указатель мыши/пальца, для клавиатуры — проекция карточки', () => {
  it('мышь: clientY активатора + дельта drag', () => {
    expect(
      dropAnchorY({
        activatorEvent: { clientY: 100, clientX: 10 },
        deltaY: 60,
        activeProjected: { top: 0, height: 10 },
      }),
    ).toBe(160);
  });

  it('клиентская координата 0 — валидная (верх экрана), не «нет данных»', () => {
    expect(dropAnchorY({ activatorEvent: { clientY: 0 }, deltaY: 25, activeProjected: null })).toBe(
      25,
    );
  });

  it('палец: clientY первого касания', () => {
    expect(
      dropAnchorY({
        activatorEvent: { touches: [{ clientY: 300 }] },
        deltaY: -50,
        activeProjected: null,
      }),
    ).toBe(250);
  });

  it('клавиатура (нет координат) → центр проекции карточки', () => {
    expect(
      dropAnchorY({
        activatorEvent: { key: 'ArrowDown' },
        deltaY: 80,
        activeProjected: { top: 200, height: 60 },
      }),
    ).toBe(230);
  });

  it('геометрии нет вовсе → null (борд не двигаем)', () => {
    expect(dropAnchorY({ activatorEvent: undefined, deltaY: 0, activeProjected: null })).toBeNull();
  });
});

describe('activatorPointerY', () => {
  it('не-событие и отсутствие координат — null', () => {
    expect(activatorPointerY(undefined)).toBeNull();
    expect(activatorPointerY('ArrowDown')).toBeNull();
    expect(activatorPointerY({})).toBeNull();
    expect(activatorPointerY({ touches: [] })).toBeNull();
  });

  it('changedTouches как источник (touchend-активация)', () => {
    expect(activatorPointerY({ changedTouches: [{ clientY: 42 }] })).toBe(42);
  });
});
