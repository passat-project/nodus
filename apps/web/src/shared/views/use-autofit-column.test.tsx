// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAutoFitColumn } from './use-autofit-column.js';
import { uiPx } from '../ui/ui-scale.js';

/**
 * Двойной клик по ручке (#937): автоподбор ширины одной колонки по контенту,
 * в пределах minWidth..maxWidth поля.
 */

function sized(width: number): HTMLElement {
  const element = document.createElement('span');
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: width });
  return element;
}

/** Строки таблицы: ведущая ячейка + одна колонка поля. */
function rows(widths: number[]): HTMLElement {
  const container = document.createElement('div');
  for (const width of widths) {
    const row = document.createElement('div');
    row.append(sized(0));
    const cell = document.createElement('span');
    cell.append(sized(width));
    row.append(cell);
    container.append(row);
  }
  return container;
}

describe('useAutoFitColumn', () => {
  it('ставит ширину по самому широкому содержимому плюс воздух', () => {
    const setWidth = vi.fn();
    const ref = { current: rows([120, 200, 150]) };
    const { result } = renderHook(() => useAutoFitColumn(ref, 1, setWidth));

    result.current(0, 'subject', uiPx(48), uiPx(640));

    expect(setWidth).toHaveBeenCalledWith('subject', 200 + uiPx(24));
  });

  it('не выходит за maxWidth поля', () => {
    const setWidth = vi.fn();
    const ref = { current: rows([5000]) };
    const { result } = renderHook(() => useAutoFitColumn(ref, 1, setWidth));

    result.current(0, 'subject', uiPx(48), uiPx(640));

    expect(setWidth).toHaveBeenCalledWith('subject', uiPx(640));
  });

  it('пустая таблица ширину не меняет', () => {
    const setWidth = vi.fn();
    const ref = { current: rows([]) };
    const { result } = renderHook(() => useAutoFitColumn(ref, 2, setWidth));

    result.current(0, 'subject', uiPx(48), uiPx(640));

    expect(setWidth).not.toHaveBeenCalled();
  });
});
