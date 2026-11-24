import { describe, expect, it } from 'vitest';

import { formatDuration, parseDuration } from './minutes.js';

describe('parseDuration (#311)', () => {
  it.each([
    ['1ч 30м', 90],
    ['1 ч', 60],
    ['45м', 45],
    ['45 мин', 45],
    ['2h', 120],
    ['1:30', 90],
    ['1.5', 90],
    ['1,5', 90],
    ['2', 120],
    ['90', 90],
    ['  3ч15м ', 195],
  ])('%s → %i', (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });

  it.each(['', 'abc', '0', '0м', '1:75', 'ч'])('%s → null', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe('parseDuration: предел планового времени (#1009)', () => {
  it('100 000 минут включительно — валидно', () => {
    expect(parseDuration('100000')).toBe(100_000);
    expect(parseDuration('1666ч 40м')).toBe(100_000);
  });

  it.each(['100001', '2000ч', '1667ч', '100001м'])('%s → null (больше предела)', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('часы и минуты', () => {
    expect(formatDuration(90, 'ч', 'м')).toBe('1 ч 30 м');
    expect(formatDuration(120, 'ч', 'м')).toBe('2 ч');
    expect(formatDuration(45, 'ч', 'м')).toBe('45 м');
  });
});
