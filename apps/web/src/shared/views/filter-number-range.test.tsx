// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { NumberRangeControl, parseDurationFilter } from './filter-number-range.js';
import type { FilterFieldDef } from './list-filters.js';

/** «Продолжительность» в фильтре (#843): «1:75» — не 135 минут, а ошибка ввода. */
describe('parseDurationFilter', () => {
  it('«ч:мм» → минуты', () => {
    expect(parseDurationFilter('1:30')).toBe(90);
    expect(parseDurationFilter('0:59')).toBe(59);
    // Без двоеточия — часы («12» = 12 часов), как в формате продолжительности.
    expect(parseDurationFilter('12')).toBe(720);
  });

  it('минуты только 0…59: «1:75» и «1:60» не разбираются', () => {
    expect(parseDurationFilter('1:75')).toBeUndefined();
    expect(parseDurationFilter('1:60')).toBeUndefined();
  });

  it('мусор и отрицательные значения отклоняются', () => {
    expect(parseDurationFilter('-1:30')).toBeUndefined();
    expect(parseDurationFilter('1:3a')).toBeUndefined();
    expect(parseDurationFilter('')).toBeUndefined();
  });
});

const DURATION = {
  id: 'duration',
  label: 'Длительность',
  numberFormat: 'duration',
} as FilterFieldDef<unknown>;

afterEach(cleanup);

describe('NumberRangeControl: разбор продолжительности в контроле', () => {
  it('«1:75» не превращается в 135 минут и не уходит в фильтр', () => {
    const onChange = vi.fn();
    render(<NumberRangeControl def={DURATION} value={undefined} onChange={onChange} />);
    const from = screen.getByLabelText(`Длительность: ${ui.filters.numberFrom}`);

    fireEvent.change(from, { target: { value: '1:75' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);

    fireEvent.change(from, { target: { value: '1:30' } });
    expect(onChange).toHaveBeenLastCalledWith({ from: 90, to: undefined });
  });
});
