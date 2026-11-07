import { describe, expect, it } from 'vitest';
import type { MoneyValue } from '@nodus/contracts';

import {
  arithmetic,
  asBoolean,
  asDate,
  asNumber,
  compareValues,
  formatByPattern,
  roundDownAway,
  roundHalfAway,
  roundUpAway,
  RuntimeFailure,
  textOf,
} from './runtime.js';

/** Рантайм-помощники движка (#632): приведение типов, округление как в
 *  Excel (от нуля), формат ТЕКСТ, сравнение и арифметика денег — все
 *  ошибочные ветви дают сбой ячейки (RuntimeFailure), не исключение наружу. */

function failureOf(run: () => unknown): RuntimeFailure {
  try {
    run();
  } catch (error) {
    if (error instanceof RuntimeFailure) return error;
    throw error;
  }
  throw new Error('ожидали RuntimeFailure, вызов прошёл без ошибки');
}

const money = (amount: number, currencyId = 'byn'): MoneyValue => ({ amount, currencyId });

describe('runtime: приведение значений', () => {
  it('текст: null пуст, дефис-маркер пуст, число с запятой, флаги по-русски', () => {
    expect(textOf(null)).toBe('');
    expect(textOf('—')).toBe('');
    expect(textOf('– -')).toBe('');
    expect(textOf('КЖ')).toBe('КЖ');
    expect(textOf(2.5)).toBe('2,5');
    expect(textOf(Number.POSITIVE_INFINITY)).toBe('');
    expect(textOf(true)).toBe('ИСТИНА');
    expect(textOf(false)).toBe('ЛОЖЬ');
    expect(textOf(['—', 'x', '–'])).toBe('x');
    expect(textOf(money(2.5))).toBe('2,5');
  });

  it('число: только конечное число, иначе сбой ячейки', () => {
    expect(asNumber(5)).toBe(5);
    expect(failureOf(() => asNumber('5')).code).toBe('type_mismatch');
    expect(failureOf(() => asNumber(Number.NaN)).code).toBe('type_mismatch');
  });

  it('флаг: null — false, не-флаг — сбой', () => {
    expect(asBoolean(null)).toBe(false);
    expect(asBoolean(true)).toBe(true);
    expect(failureOf(() => asBoolean('да')).code).toBe('type_mismatch');
  });

  it('дата: только ISO-строка с датой', () => {
    expect(asDate('2026-01-02T10:00:00Z').getTime()).toBe(Date.parse('2026-01-02T10:00:00Z'));
    expect(failureOf(() => asDate(5)).code).toBe('type_mismatch');
    expect(failureOf(() => asDate('не дата')).code).toBe('type_mismatch');
  });
});

describe('runtime: округление как в Excel (от нуля) и формат ТЕКСТ', () => {
  it('ОКРУГЛ: половина — от нуля, float-шум подавлен', () => {
    expect(roundHalfAway(2.675, 2)).toBe(2.68);
    expect(roundHalfAway(-2.675, 2)).toBe(-2.68);
    expect(roundHalfAway(2.4, 0)).toBe(2);
  });

  it('ОКРУГЛВВЕРХ/ОКРУГЛВНИЗ: от нуля, не к нулю', () => {
    expect(roundUpAway(2.1, 0)).toBe(3);
    expect(roundUpAway(-2.1, 0)).toBe(-3);
    expect(roundUpAway(2.671, 2)).toBe(2.68);
    expect(roundDownAway(2.9, 0)).toBe(2);
    expect(roundDownAway(-2.9, 0)).toBe(-2);
    expect(roundDownAway(2.679, 2)).toBe(2.67);
  });

  it('ТЕКСТ: «00» — минимум целых, «0.00» — дробные, минус сохраняется', () => {
    expect(formatByPattern(5, '00')).toBe('05');
    expect(formatByPattern(5, '0.00')).toBe('5.00');
    expect(formatByPattern(-2.5, '0.0')).toBe('-2.5');
    expect(formatByPattern(123, '0')).toBe('123');
    expect(formatByPattern(0, '000')).toBe('000');
  });
});

describe('runtime: сравнение', () => {
  it('деньги сравниваются в минорных единицах одной валюты', () => {
    expect(compareValues(money(1.4), money(1.5), 'lt')).toBe(true);
    expect(compareValues(money(1.5), money(1.5), 'eq')).toBe(true);
    expect(compareValues(money(1.5), money(1.5), 'ne')).toBe(false);
    expect(failureOf(() => compareValues(money(1), money(1, 'usd'), 'eq')).code).toBe(
      'type_mismatch',
    );
  });

  it('числа и строки сравниваются по порядку', () => {
    expect(compareValues(1, 2, 'le')).toBe(true);
    expect(compareValues(2, 1, 'gt')).toBe(true);
    expect(compareValues('а', 'б', 'lt')).toBe(true);
    expect(compareValues('б', 'а', 'ge')).toBe(true);
  });

  it('флаги — только равно/не равно, списки — только равенство', () => {
    expect(compareValues(true, false, 'eq')).toBe(false);
    expect(compareValues(true, false, 'ne')).toBe(true);
    expect(failureOf(() => compareValues(true, false, 'lt')).code).toBe('type_mismatch');
    expect(compareValues(['a'], ['a'], 'eq')).toBe(true);
    expect(compareValues(['a'], ['a'], 'ne')).toBe(false);
    expect(failureOf(() => compareValues(['a'], ['b'], 'gt')).code).toBe('type_mismatch');
  });

  it('разные типы не сравниваются', () => {
    expect(failureOf(() => compareValues(1, '1', 'eq')).code).toBe('type_mismatch');
  });
});

describe('runtime: арифметика', () => {
  it('null-операнд — null без ошибки', () => {
    expect(arithmetic('add', null, 1)).toBeNull();
    expect(arithmetic('mul', 2, null)).toBeNull();
  });

  it('не-число вместо числа — сбой ячейки', () => {
    expect(failureOf(() => arithmetic('add', '2', 3)).code).toBe('type_mismatch');
    expect(failureOf(() => arithmetic('div', 1, 0)).code).toBe('division_by_zero');
  });

  it('деньги ± деньги одной валюты — деньги в минорных единицах', () => {
    expect(arithmetic('sub', money(2.55), money(1.05))).toEqual(money(1.5));
    expect(failureOf(() => arithmetic('add', money(1), 3)).code).toBe('type_mismatch');
    expect(failureOf(() => arithmetic('add', money(1), money(1, 'usd'))).code).toBe(
      'type_mismatch',
    );
  });

  it('деньги × число — деньги (минорные, с округлением), деньги × деньги — сбой', () => {
    expect(arithmetic('mul', money(1.25), 2)).toEqual(money(2.5));
    expect(arithmetic('mul', 2, money(1.25))).toEqual(money(2.5));
    expect(failureOf(() => arithmetic('mul', money(1), money(2))).code).toBe('type_mismatch');
  });

  it('деление денег: на число — деньги, деньги/деньги — число, ноль — сбой', () => {
    expect(arithmetic('div', money(5), 2)).toEqual(money(2.5));
    expect(arithmetic('div', money(5), money(2))).toBe(2.5);
    expect(failureOf(() => arithmetic('div', money(5), 0)).code).toBe('division_by_zero');
    expect(failureOf(() => arithmetic('div', money(5), money(0))).code).toBe('division_by_zero');
    expect(failureOf(() => arithmetic('div', 5, money(2))).code).toBe('type_mismatch');
  });
});
