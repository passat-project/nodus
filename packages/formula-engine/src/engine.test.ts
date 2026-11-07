import { describe, expect, it } from 'vitest';
import type { FormulaNode } from '@nodus/contracts';

import { evaluate } from './index.js';
import { lit, op, resolver, self } from './test-kit.js';

describe('evaluate: базовые значения и null-семантика', () => {
  it('конкатенация собирает шифр из атрибутов и пропускает пустое', () => {
    const ast: FormulaNode = {
      kind: 'op',
      op: 'concat',
      args: [self(1), lit('-'), self(2), lit('-'), self(3), self(4)],
    };
    const result = evaluate(ast, resolver({ self: { 1: 'I001', 2: 'Здание 1', 3: 'ОВ', 4: 12 } }));
    expect(result).toEqual({ value: 'I001-Здание 1-ОВ12', error: null });
  });

  it('пустой атрибут даёт null, арифметика с null — null', () => {
    const ast = op('add', self(1), self(2));
    expect(evaluate(ast, resolver({ self: { 1: 4 } })).value).toBeNull();
  });

  it('сравнение с null — false', () => {
    const ast = op('eq', self(1), lit(0));
    expect(evaluate(ast, resolver({ self: {} })).value).toBe(false);
  });

  it('деление на ноль — ошибка ячейки, значение пустое', () => {
    const ast = op('div', self(1), self(2));
    const result = evaluate(ast, resolver({ self: { 1: 10, 2: 0 } }));
    expect(result.value).toBeNull();
    expect(result.error?.code).toBe('division_by_zero');
  });

  it('недоступный источник (нет родителя) — source_unavailable', () => {
    const ast: FormulaNode = { kind: 'field', source: { kind: 'parent_task' }, number: 1 };
    const result = evaluate(ast, resolver({ self: { 1: 'x' }, parent: null }));
    expect(result.value).toBeNull();
    expect(result.error?.code).toBe('source_unavailable');
  });
});

describe('evaluate: деньги', () => {
  const money = (amount: number, currencyId = 'cur-1') => ({ amount, currencyId });

  it('сложение в минорных единицах без float-погрешности', () => {
    const ast = op('add', self(1), self(2));
    const result = evaluate(ast, resolver({ self: { 1: money(0.1), 2: money(0.2) } }));
    expect(result.value).toEqual({ amount: 0.3, currencyId: 'cur-1' });
  });

  it('деньги × число — деньги, деньги × деньги — ошибка типа', () => {
    expect(
      evaluate(op('mul', self(1), self(2)), resolver({ self: { 1: money(100), 2: 3 } })).value,
    ).toEqual({
      amount: 300,
      currencyId: 'cur-1',
    });
    expect(
      evaluate(op('mul', self(1), self(2)), resolver({ self: { 1: money(100), 2: money(2) } }))
        .error?.code,
    ).toBe('type_mismatch');
  });

  it('разные валюты — ошибка типа', () => {
    const result = evaluate(
      op('add', self(1), self(2)),
      resolver({ self: { 1: money(10, 'a'), 2: money(10, 'b') } }),
    );
    expect(result.error?.code).toBe('type_mismatch');
  });

  it('деньги / деньги одной валюты — число', () => {
    const result = evaluate(
      op('div', self(1), self(2)),
      resolver({ self: { 1: money(300), 2: money(100) } }),
    );
    expect(result.value).toBe(3);
  });
});

describe('evaluate: функции', () => {
  it('ЕСЛИ ленив и не считает невыбранную ветку', () => {
    const ast: FormulaNode = {
      kind: 'call',
      fn: 'if',
      args: [op('gt', self(1), lit(0)), lit('да'), op('div', lit(1), lit(0))],
    };
    expect(evaluate(ast, resolver({ self: { 1: 5 } })).value).toBe('да');
  });

  it('И/ИЛИ/НЕ и пустое как false', () => {
    const ast: FormulaNode = {
      kind: 'call',
      fn: 'and',
      args: [lit(true), { kind: 'call', fn: 'not', args: [self(1)] }],
    };
    expect(evaluate(ast, resolver({ self: {} })).value).toBe(true);
  });

  it('ОКРУГЛ/ОКРУГЛВВЕРХ/ОКРУГЛВНИЗ', () => {
    const round = (fn: 'round' | 'roundup' | 'rounddown', value: number) =>
      evaluate({ kind: 'call', fn, args: [lit(value), lit(1)] }, resolver({})).value;
    expect(round('round', 1.25)).toBe(1.3);
    expect(round('round', -1.25)).toBe(-1.3);
    expect(round('roundup', 1.21)).toBe(1.3);
    expect(round('rounddown', 1.29)).toBe(1.2);
  });

  it('ЛЕВСИМВ/ПРАВСИМВ/ДЛСТР', () => {
    const call = (fn: 'left' | 'right' | 'len', args: FormulaNode[]) =>
      evaluate({ kind: 'call', fn, args }, resolver({})).value;
    expect(call('left', [lit('ОВ-12'), lit(2)])).toBe('ОВ');
    expect(call('right', [lit('ОВ-12'), lit(2)])).toBe('12');
    expect(call('len', [lit('ОВ-12')])).toBe(5);
    expect(call('len', [self(1)])).toBe(0);
  });

  it('ТЕКСТ дополняет нулями', () => {
    expect(
      evaluate({ kind: 'call', fn: 'text', args: [lit(7), lit('000')] }, resolver({})).value,
    ).toBe('007');
    expect(
      evaluate({ kind: 'call', fn: 'text', args: [lit(7.5), lit('00.00')] }, resolver({})).value,
    ).toBe('07.50');
  });

  it('ГОД/МЕСЯЦ/ДЕНЬ и РАЗНДАТ по ISO-датам', () => {
    const call = (fn: 'year' | 'month' | 'day', value: string) =>
      evaluate({ kind: 'call', fn, args: [lit(value)] }, resolver({})).value;
    expect(call('year', '2026-11-06')).toBe(2026);
    expect(call('month', '2026-11-06')).toBe(11);
    expect(call('day', '2026-11-06')).toBe(6);
    const datedif = (from: string, to: string, unit: string) =>
      evaluate({ kind: 'call', fn: 'datedif', args: [lit(from), lit(to), lit(unit)] }, resolver({}))
        .value;
    expect(datedif('2026-01-01', '2026-03-15', 'days')).toBe(73);
    expect(datedif('2026-01-01', '2026-03-15', 'months')).toBe(2);
    expect(datedif('2026-01-01', '2028-03-15', 'years')).toBe(2);
  });
});

describe('concat: пустые операнды не оставляют висячих разделителей (#632)', () => {
  const concat = (...args: FormulaNode[]): FormulaNode => ({ kind: 'op', op: 'concat', args });

  it('пустая папка в середине — разделители схлопываются', () => {
    const ast = concat(self(1), lit('-'), self(2), lit('-'), self(3), self(4));
    expect(evaluate(ast, resolver({ self: { 1: '2026-42' } }))).toEqual({
      value: '2026-42',
      error: null,
    });
  });

  it('пустое значение в начале/конце — без ведущего/висячего дефиса', () => {
    expect(evaluate(concat(lit('-'), self(1)), resolver({ self: { 1: 'A' } })).value).toBe('A');
    expect(evaluate(concat(self(1), lit('-')), resolver({ self: { 1: 'A' } })).value).toBe('A');
  });

  it('одинокий литерал-дефис остаётся литералом', () => {
    expect(evaluate(concat(lit('-')), resolver({ self: {} })).value).toBe('-');
  });

  it('все поля пусты, разделители есть — пустая строка, не дефис-маркер', () => {
    // `А & "-" & Б` при пустых А и Б = '', а не '-': движок не генерирует
    // легаси-маркер пустоты (фикс «кривого дефиса» у наследованных формул).
    expect(evaluate(concat(self(1), lit('-'), self(2)), resolver({ self: {} })).value).toBe('');
    expect(
      evaluate(concat(self(1), lit('-'), self(2), lit('-'), self(3)), resolver({ self: {} })).value,
    ).toBe('');
  });

  it('непустые операнды сохраняют разделитель', () => {
    expect(
      evaluate(concat(self(1), lit('-'), self(2)), resolver({ self: { 1: 'A', 2: 'B' } })).value,
    ).toBe('A-B');
  });
});

describe('шифр комплекта: пустые папка/марка/номер не оставляют дефисов (#632)', () => {
  it('2026-42-- → 2026-42, когда пусты № по ГП, марка и номер', () => {
    const ast: FormulaNode = {
      kind: 'op',
      op: 'concat',
      args: [self(1), lit('-'), self(2), lit('-'), self(3), self(4)],
    };
    expect(evaluate(ast, resolver({ self: { 1: '2026-42' } }))).toEqual({
      value: '2026-42',
      error: null,
    });
  });
});

describe('concat: типографский разделитель — литерал, а не пустой маркер (#632)', () => {
  const concat = (...args: FormulaNode[]): FormulaNode => ({ kind: 'op', op: 'concat', args });

  it('«—» между непустыми значениями сохраняется', () => {
    expect(
      evaluate(concat(self(1), lit('—'), self(2)), resolver({ self: { 1: 'A', 2: 'B' } })).value,
    ).toBe('A—B');
    expect(
      evaluate(concat(self(1), lit('–'), self(2)), resolver({ self: { 1: 'A', 2: 'B' } })).value,
    ).toBe('A–B');
    expect(
      evaluate(concat(self(1), lit('−'), self(2)), resolver({ self: { 1: 'A', 2: 'B' } })).value,
    ).toBe('A−B');
  });

  it('«—» у пустого соседа по-прежнему не оставляет висячий разделитель', () => {
    expect(evaluate(concat(self(1), lit('—')), resolver({ self: { 1: 'A' } })).value).toBe('A');
    expect(evaluate(concat(lit('—'), self(1)), resolver({ self: { 1: 'A' } })).value).toBe('A');
  });
});

describe('логика: ленивые И/ИЛИ и арность (#632)', () => {
  const call = (
    fn: Extract<FormulaNode, { kind: 'call' }>['fn'],
    ...args: FormulaNode[]
  ): FormulaNode => ({ kind: 'call', fn, args });

  it('И/ИЛИ не вычисляют правую часть, когда исход уже определён', () => {
    const divideByZero = op('div', lit(1), lit(0));
    expect(evaluate(call('or', lit(true), divideByZero), resolver({})).value).toBe(true);
    expect(evaluate(call('and', lit(false), divideByZero), resolver({})).value).toBe(false);
  });

  it('И/ИЛИ с ошибкой в нужной ветке — ошибка ячейки', () => {
    const divideByZero = op('div', lit(1), lit(0));
    expect(evaluate(call('or', lit(false), divideByZero), resolver({})).error?.code).toBe(
      'division_by_zero',
    );
    expect(evaluate(call('and', lit(true), divideByZero), resolver({})).error?.code).toBe(
      'division_by_zero',
    );
  });

  it('НЕ без аргумента — ошибка, а не ИСТИНА', () => {
    expect(evaluate(call('not'), resolver({})).error?.code).toBe('type_mismatch');
  });

  it('бинарный оператор с лишним аргументом — ошибка, а не потеря аргумента', () => {
    const ast: FormulaNode = { kind: 'op', op: 'add', args: [lit(1), lit(2), lit(3)] };
    expect(evaluate(ast, resolver({})).error?.code).toBe('type_mismatch');
  });
});

describe('округление без двоичного шума (#632)', () => {
  const call = (fn: 'round' | 'roundup' | 'rounddown', value: number, digits: number) =>
    evaluate({ kind: 'call', fn, args: [lit(value), lit(digits)] }, resolver({})).value;

  it('ОКРУГЛ(2.675; 2) = 2.68, как в Excel', () => {
    expect(call('round', 2.675, 2)).toBe(2.68);
    expect(call('round', -2.675, 2)).toBe(-2.68);
  });

  it('ОКРУГЛВВЕРХ/ВНИЗ на целых не прыгают из-за эпсилона', () => {
    expect(call('roundup', 1, 0)).toBe(1);
    expect(call('rounddown', 1, 0)).toBe(1);
    expect(call('roundup', 1.0000005, 0)).toBe(2);
    expect(call('rounddown', 1.999999999, 0)).toBe(1);
  });
});
