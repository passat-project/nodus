import { describe, expect, it } from 'vitest';

import {
  formatDateRu,
  monthGridCells,
  parseIsoDate,
  parseTime,
  quickOptionDate,
  timeSlots,
} from './date-time-grid.js';

// Сентябрь 2026: 1-е — вторник (15-е — тоже вторник, сверено с продом).
describe('monthGridCells', () => {
  const cells = monthGridCells(2026, 8);
  const at = (i: number) => {
    const cell = cells[i];
    if (!cell) throw new Error(`нет ячейки ${i}`);
    return cell;
  };

  it('42 ячейки, начало с понедельника недели 1-го числа', () => {
    expect(cells).toHaveLength(42);
    expect(at(0).date.getDay()).toBe(1); // понедельник
    expect(at(0).date.getDate()).toBe(31); // 31 августа
    expect(at(0).inMonth).toBe(false);
  });

  it('первое число месяца — в месяце и на своём месте', () => {
    expect(at(1).date.getDate()).toBe(1);
    expect(at(1).inMonth).toBe(true);
    expect(at(30).date.getDate()).toBe(30); // 30 сентября
    expect(at(30).inMonth).toBe(true);
    expect(at(31).inMonth).toBe(false); // 1 октября
  });
});

describe('quickOptionDate', () => {
  const tuesday = new Date(2026, 8, 15, 12, 0); // вторник 15.09.2026

  it('варианты от вторника', () => {
    expect(quickOptionDate('today', tuesday).getDate()).toBe(15);
    expect(quickOptionDate('tomorrow', tuesday).getDate()).toBe(16);
    // Ближайшая пятница — 18-е; «через неделю» — 22-е; конец месяца — 30-е.
    expect(quickOptionDate('endOfWeek', tuesday).getDate()).toBe(18);
    expect(quickOptionDate('inAWeek', tuesday).getDate()).toBe(22);
    expect(quickOptionDate('endOfMonth', tuesday).getDate()).toBe(30);
  });

  it('в пятницу «конец недели» — тот же день', () => {
    const friday = new Date(2026, 8, 18, 9, 0);
    expect(quickOptionDate('endOfWeek', friday).getDate()).toBe(18);
  });
});

describe('parseTime', () => {
  it('валидное и невалидное время', () => {
    expect(parseTime('17:00')).toEqual({ hours: 17, minutes: 0 });
    expect(parseTime('9:05')).toEqual({ hours: 9, minutes: 5 });
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('17:60')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });
});

describe('parseIsoDate / formatDateRu (#923)', () => {
  it('ISO-дата контрактов → локальная дата и обратно', () => {
    const date = parseIsoDate('1990-01-12');
    expect(date?.getFullYear()).toBe(1990);
    expect(date?.getMonth()).toBe(0);
    expect(date?.getDate()).toBe(12);
    expect(formatDateRu(date!)).toBe('12.01.1990');
  });

  it('пустое и нереальное (31.02) — null, не «3 марта»', () => {
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate('1990-02-31')).toBeNull();
    expect(parseIsoDate('12.01.1990')).toBeNull();
  });
});

describe('timeSlots (#923)', () => {
  it('сетка 15 минут: от 00:00 до 23:45, 96 слотов', () => {
    const slots = timeSlots(15);
    expect(slots).toHaveLength(96);
    expect(slots[0]).toBe('00:00');
    expect(slots[1]).toBe('00:15');
    expect(slots.at(-1)).toBe('23:45');
  });
});
