// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { cellContentWidth, COLUMN_BREATHING, measureColumnContents } from './column-content.js';
import { uiPx } from '../ui/ui-scale.js';

/**
 * Замер содержимого колонок (#937): общий источник авто-раскладки и
 * двойного клика по ручке. jsdom не считает layout — ширину содержимого
 * подставляем в `scrollWidth` сами.
 */

/** Элемент с заданным scrollWidth (как посчитал бы браузер). */
function sized(tag: string, width: number): HTMLElement {
  const element = document.createElement(tag);
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: width });
  return element;
}

function cell(field: string, childWidths: number[]): HTMLElement {
  const element = document.createElement('span');
  element.dataset.cellField = field;
  for (const width of childWidths) element.append(sized('span', width));
  return element;
}

function header(field: string, childWidths: number[], { resizer = false, sortable = false } = {}) {
  const element = document.createElement('span');
  element.dataset.headerField = field;
  for (const width of childWidths) element.append(sized('span', width));
  if (resizer) {
    const handle = sized('span', 8);
    handle.setAttribute('role', 'separator');
    element.append(handle);
  }
  element.tabIndex = sortable ? 0 : -1;
  return element;
}

function table(children: HTMLElement[]): HTMLElement {
  const container = document.createElement('div');
  container.append(...children);
  return container;
}

describe('cellContentWidth', () => {
  it('суммирует детей ячейки и зазоры между ними', () => {
    expect(cellContentWidth(cell('a', [100, 50]))).toBe(100 + 50 + uiPx(8));
  });

  it('лишнее «дыхание» колонки — 24 design-px', () => {
    expect(COLUMN_BREATHING).toBe(uiPx(24));
  });
});

describe('measureColumnContents', () => {
  it('берёт максимум по строкам каждой колонки', () => {
    const container = table([cell('subject', [300]), cell('date', [80]), cell('subject', [120])]);
    expect(measureColumnContents(container)).toEqual({ subject: 300, date: 80 });
  });

  it('без ячеек мерить нечего — null (таблица ещё не отрисована)', () => {
    expect(measureColumnContents(table([]))).toBeNull();
  });

  it('заголовок шире данных — колонка не обрезает подпись', () => {
    const container = table([cell('regDate', [120]), header('regDate', [200])]);
    expect(measureColumnContents(container)?.regDate).toBe(200);
  });

  it('место под ручку ресайза и стрелку сортировки резервируется, сама ручка не в сумме', () => {
    const container = table([
      cell('subject', [100]),
      header('subject', [150], { resizer: true, sortable: true }),
    ]);
    const expected = 150 + uiPx(12) + uiPx(16);
    expect(measureColumnContents(container)?.subject).toBe(expected);
  });

  it('заголовок без ручки и сортировки — только его текст', () => {
    const container = table([cell('name', [90]), header('name', [70])]);
    expect(measureColumnContents(container)?.name).toBe(90);
  });
});
