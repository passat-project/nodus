import type { FormulaErrorCode, FormulaOperator, MoneyValue } from '@nodus/contracts';

import type { FormulaValue } from './types.js';

/** Общие помощники вычисления формул (#632): сбой ячейки, деньги в минорных
 *  единицах, приведение типов, сравнение и арифметика. */

/** Сбой вычисления одной ячейки: движок не бросает наружу — ячейка
 *  показывает ошибку, остальная работа продолжается (Р4/Р13). */
export class RuntimeFailure extends Error {
  constructor(
    readonly code: FormulaErrorCode,
    message: string,
    readonly number?: number,
  ) {
    super(message);
    this.name = 'FormulaRuntimeFailure';
  }
}

export function fail(code: FormulaErrorCode, message: string, number?: number): never {
  throw new RuntimeFailure(code, message, number);
}

export function isMoney(value: FormulaValue): value is MoneyValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'amount' in value &&
    'currencyId' in value
  );
}

export function moneyMinor(money: MoneyValue): number {
  return Math.round(money.amount * 100);
}

export function moneyFromMinor(minor: number, currencyId: string): MoneyValue {
  return { amount: minor / 100, currencyId };
}

/** Текст значения для «&» и текстовых функций: число — без группировки,
 *  десятичная запятая (русская деловая запись), флаг — ИСТИНА/ЛОЖЬ. */
export function textOf(value: FormulaValue): string {
  if (value === null) return '';
  if (typeof value === 'string') {
    // Типографский «пустой» маркер из старых данных/подсказок не должен
    // попадать в склейку: пустое значение — это пусто, а не дефис.
    return value === '—' || value === '–' || value === '−' ? '' : value;
  }
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value).replace('.', ',') : '';
  if (typeof value === 'boolean') return value ? 'ИСТИНА' : 'ЛОЖЬ';
  if (Array.isArray(value)) return value.join(', ');
  return String(value.amount).replace('.', ',');
}

export function asNumber(value: FormulaValue, number?: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fail('type_mismatch', 'value is not a number', number);
}

export function asText(value: FormulaValue): string {
  return textOf(value);
}

export function asBoolean(value: FormulaValue): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  return fail('type_mismatch', 'value is not a boolean');
}

export function asDate(value: FormulaValue): Date {
  if (typeof value !== 'string') fail('type_mismatch', 'value is not a date');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail('type_mismatch', 'value is not a date');
  return date;
}

export function roundHalfAway(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = Math.abs(value) * factor;
  const rounded = Math.round(scaled);
  const result = rounded / factor;
  return value < 0 ? -result : result;
}

export function roundUpAway(value: number, digits: number): number {
  const factor = 10 ** digits;
  const result = Math.ceil(Math.abs(value) * factor - 1e-9) / factor;
  return value < 0 ? -result : result;
}

export function roundDownAway(value: number, digits: number): number {
  const factor = 10 ** digits;
  const result = Math.floor(Math.abs(value) * factor + 1e-9) / factor;
  return value < 0 ? -result : result;
}

/** Формат ТЕКСТ: «00» — минимум знаков целой части, «0.00» — ещё и дробная. */
export function formatByPattern(value: number, pattern: string): string {
  const [integerPattern = '0', fractionPattern] = pattern.split('.');
  const integerDigits = Math.max((integerPattern.match(/0/g) ?? []).length, 1);
  const fractionDigits = fractionPattern ? (fractionPattern.match(/0/g) ?? []).length : 0;
  const rounded = roundHalfAway(value, fractionDigits);
  const negative = rounded < 0;
  const absolute = Math.abs(rounded);
  const [integerPart = '0', fractionPart = ''] = absolute.toFixed(fractionDigits).split('.');
  const paddedInteger = integerPart.padStart(integerDigits, '0');
  const paddedFraction =
    fractionDigits > 0 ? `.${(fractionPart ?? '').padEnd(fractionDigits, '0')}` : '';
  return `${negative ? '-' : ''}${paddedInteger}${paddedFraction}`;
}

export function compareValues(
  left: FormulaValue,
  right: FormulaValue,
  operator: FormulaOperator,
): boolean {
  if (isMoney(left) && isMoney(right)) {
    if (left.currencyId !== right.currencyId) {
      return fail('type_mismatch', 'money values have different currencies');
    }
    return compareNumbers(moneyMinor(left), moneyMinor(right), operator);
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return compareNumbers(left, right, operator);
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return compareStrings(left, right, operator);
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    if (operator === 'eq') return left === right;
    if (operator === 'ne') return left !== right;
    return fail('type_mismatch', 'booleans cannot be ordered');
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const equal =
      left.length === right.length && left.every((item, index) => item === right[index]);
    if (operator === 'eq') return equal;
    if (operator === 'ne') return !equal;
    return fail('type_mismatch', 'lists cannot be ordered');
  }
  return fail('type_mismatch', 'values have different types');
}

function compareNumbers(left: number, right: number, operator: FormulaOperator): boolean {
  switch (operator) {
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    case 'lt':
      return left < right;
    case 'le':
      return left <= right;
    case 'gt':
      return left > right;
    case 'ge':
      return left >= right;
    default:
      return fail('type_mismatch', `operator ${operator} is not a comparison`);
  }
}

function compareStrings(left: string, right: string, operator: FormulaOperator): boolean {
  switch (operator) {
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    case 'lt':
      return left < right;
    case 'le':
      return left <= right;
    case 'gt':
      return left > right;
    case 'ge':
      return left >= right;
    default:
      return fail('type_mismatch', `operator ${operator} is not a comparison`);
  }
}

export function arithmetic(
  operator: 'add' | 'sub' | 'mul' | 'div',
  left: FormulaValue,
  right: FormulaValue,
): FormulaValue {
  if (left === null || right === null) return null;
  const moneyLeft = isMoney(left);
  const moneyRight = isMoney(right);
  if (!moneyLeft && !moneyRight) {
    const a = asNumber(left);
    const b = asNumber(right);
    switch (operator) {
      case 'add':
        return a + b;
      case 'sub':
        return a - b;
      case 'mul':
        return a * b;
      case 'div':
        if (b === 0) fail('division_by_zero', 'division by zero');
        return a / b;
    }
  }
  if (operator === 'add' || operator === 'sub') {
    if (!isMoney(left) || !isMoney(right)) {
      fail('type_mismatch', 'money can be added only to money');
    }
    if (left.currencyId !== right.currencyId) {
      fail('type_mismatch', 'money values have different currencies');
    }
    const a = moneyMinor(left);
    const b = moneyMinor(right);
    return moneyFromMinor(operator === 'add' ? a + b : a - b, left.currencyId);
  }
  if (operator === 'mul') {
    if (isMoney(left) && isMoney(right))
      fail('type_mismatch', 'money cannot be multiplied by money');
    if (isMoney(left)) {
      const factor = asNumber(right);
      return moneyFromMinor(Math.round(moneyMinor(left) * factor), left.currencyId);
    }
    if (!isMoney(right)) fail('type_mismatch', 'money can be multiplied only by a number');
    const factor = asNumber(left);
    return moneyFromMinor(Math.round(moneyMinor(right) * factor), right.currencyId);
  }
  if (isMoney(left) && isMoney(right)) {
    if (left.currencyId !== right.currencyId) {
      fail('type_mismatch', 'money values have different currencies');
    }
    const divisor = moneyMinor(right);
    if (divisor === 0) fail('division_by_zero', 'division by zero');
    return moneyMinor(left) / divisor;
  }
  if (isMoney(left)) {
    const divisor = asNumber(right);
    if (divisor === 0) fail('division_by_zero', 'division by zero');
    return moneyFromMinor(Math.round(moneyMinor(left) / divisor), left.currencyId);
  }
  fail('type_mismatch', 'division needs a number or same-currency money');
}
