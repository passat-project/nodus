import { describe, expect, it } from 'vitest';

import {
  formatDuration,
  formatIsoDate,
  formatIsoDateTime,
  formatMoney,
  formatNumber,
  fromIsoDate,
  parseDurationInput,
  parseNumber,
  toIsoDate,
} from './value-format.js';

const NBSP = /[\u00a0\u202f]/g;

describe('формат значений полей (#431)', () => {
  it('число: группы и запятая по точности', () => {
    expect(formatNumber(1234.5, 2).replace(NBSP, ' ')).toBe('1 234,50');
    expect(formatNumber(0, 0)).toBe('0');
    expect(formatNumber(-7.25, 2).replace(NBSP, ' ')).toBe('-7,25');
  });

  it('разбор числа: пробелы и запятая, точность и модуль', () => {
    expect(parseNumber('1 234,5', 1)).toBe(1234.5);
    expect(parseNumber(' 12 ', 0)).toBe(12);
    expect(parseNumber('12,34', 1)).toBeNull();
    expect(parseNumber('abc', 0)).toBeNull();
    expect(parseNumber('10000000000001', 0)).toBeNull();
  });

  it('разбор числа: точность не ослабляется на крупных значениях', () => {
    expect(parseNumber('12 345,678', 2)).toBeNull();
    expect(parseNumber('500 000,5', 0)).toBeNull();
    expect(parseNumber('999 999 999,99', 2)).toBe(999_999_999.99);
  });

  it('деньги: сумма и код валюты', () => {
    expect(formatMoney({ amount: 1000, currencyId: 'x' }, 'BYN').replace(NBSP, ' ')).toBe(
      '1 000,00 BYN',
    );
    expect(formatMoney({ amount: 5.5, currencyId: 'x' }, null).replace(NBSP, ' ')).toBe('5,50');
  });

  it('продолжительность: ч:мм и обратный разбор', () => {
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(45)).toBe('0:45');
    expect(formatDuration(6000)).toBe('100:00');
    expect(parseDurationInput('1:30')).toBe(90);
    expect(parseDurationInput('2')).toBe(120);
    expect(parseDurationInput('1:75')).toBeNull();
    expect(parseDurationInput('0:00')).toBeNull();
    expect(parseDurationInput('100001')).toBeNull();
  });

  it('дата и дата-время: русская запись без сдвига дня', () => {
    expect(formatIsoDate('2026-10-25')).toBe('25.10.2026');
    expect(formatIsoDateTime('2026-10-25T10:05:00.000Z')).toMatch(/^25\.10\.2026 \d{2}:05$/);
  });

  it('локальная дата ↔ ISO-день', () => {
    const date = fromIsoDate('2026-10-25');
    expect(date).not.toBeNull();
    expect(toIsoDate(date!)).toBe('2026-10-25');
    expect(fromIsoDate('25.10.2026')).toBeNull();
  });
});
