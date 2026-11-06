import { describe, expect, it } from 'vitest';
import type { FormulaNode } from '@nodus/contracts';

import { evaluate, extractDeps, inferType, validateFormula } from './index.js';
import { lit, meta, op, resolver, self } from './test-kit.js';

describe('evaluate: агрегаты', () => {
  const sumNode: FormulaNode = {
    kind: 'aggregate',
    from: { kind: 'related', selector: { kind: 'subtasks' } },
    fn: 'sum',
    field: 1,
  };

  it('СУММА/СКОЛЬКО/ПОСЛЕДНЯЯ/МИН/МАКС/СРЗНАЧ по выборке', () => {
    const data = resolver({ selections: { subtasks: [{ 1: 10 }, { 1: 20 }, {}] } });
    expect(evaluate(sumNode, data).value).toBe(30);
    expect(evaluate({ ...sumNode, fn: 'count', field: undefined } as FormulaNode, data).value).toBe(
      3,
    );
    expect(evaluate({ ...sumNode, fn: 'last' } as FormulaNode, data).value).toBeNull();
    expect(evaluate({ ...sumNode, fn: 'max' } as FormulaNode, data).value).toBe(20);
    expect(evaluate({ ...sumNode, fn: 'min' } as FormulaNode, data).value).toBe(10);
    expect(evaluate({ ...sumNode, fn: 'avg' } as FormulaNode, data).value).toBe(15);
  });

  it('пустая выборка — без ошибки: СКОЛЬКО 0, СУММА 0, остальные пусто', () => {
    const empty = resolver({});
    expect(
      evaluate({ ...sumNode, fn: 'count', field: undefined } as FormulaNode, empty).value,
    ).toBe(0);
    expect(evaluate(sumNode, empty).value).toBe(0);
    expect(evaluate({ ...sumNode, fn: 'last' } as FormulaNode, empty).value).toBeNull();
    expect(evaluate({ ...sumNode, fn: 'avg' } as FormulaNode, empty).value).toBeNull();
  });

  it('УНИКАЛЬНЫЕ — список id, дубликаты убраны', () => {
    const ast: FormulaNode = { ...sumNode, fn: 'unique' };
    const data = resolver({ selections: { subtasks: [{ 1: 'a' }, { 1: 'b' }, { 1: 'a' }] } });
    expect(evaluate(ast, data).value).toEqual(['a', 'b']);
  });

  it('фильтр вычисляется по записи выборки (self внутри фильтра)', () => {
    const ast: FormulaNode = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'sum',
      field: 1,
      filter: op('gt', self(2), lit(0)),
    };
    const data = resolver({
      selections: {
        subtasks: [
          { 1: 10, 2: 1 },
          { 1: 100, 2: 0 },
          { 1: 5, 2: 1 },
        ],
      },
    });
    expect(evaluate(ast, data).value).toBe(15);
  });

  it('ВСЕ/ХОТЯ БЫ ОДНА по условию', () => {
    const base = {
      kind: 'aggregate' as const,
      from: { kind: 'related' as const, selector: { kind: 'subtasks' as const } },
      filter: op('gt', self(1), lit(0)),
    };
    const data = resolver({ selections: { subtasks: [{ 1: 1 }, { 1: 2 }] } });
    expect(evaluate({ ...base, fn: 'every' }, data).value).toBe(true);
    expect(evaluate({ ...base, fn: 'some' }, data).value).toBe(true);
    const negative = resolver({ selections: { subtasks: [{ 1: 1 }, { 1: 0 }] } });
    expect(evaluate({ ...base, fn: 'every' }, negative).value).toBe(false);
    expect(evaluate({ ...base, fn: 'some' }, negative).value).toBe(true);
  });

  it('СУММА денег одной валюты — деньги, разных — ошибка', () => {
    const ast: FormulaNode = { ...sumNode, fn: 'sum' };
    expect(
      evaluate(
        ast,
        resolver({
          selections: {
            subtasks: [
              { 1: { amount: 1.1, currencyId: 'c' } },
              { 1: { amount: 2.2, currencyId: 'c' } },
            ],
          },
        }),
      ).value,
    ).toEqual({ amount: 3.3, currencyId: 'c' });
    expect(
      evaluate(
        ast,
        resolver({
          selections: {
            subtasks: [
              { 1: { amount: 1, currencyId: 'a' } },
              { 1: { amount: 2, currencyId: 'b' } },
            ],
          },
        }),
      ).error?.code,
    ).toBe('type_mismatch');
  });

  it('выборка больше лимита — selection_limit', () => {
    const many = Array.from({ length: 501 }, (_, index) => ({ 1: index }));
    const result = evaluate(sumNode, resolver({ selections: { subtasks: many } }));
    expect(result.error?.code).toBe('selection_limit');
  });
});

describe('inferType: статический тайпинг', () => {
  const registry = meta([1, 'number'], [2, 'money'], [3, 'text'], [4, 'enum'], [5, 'multienum']);

  it('выводит тип по реестру и операторам', () => {
    expect(inferType(op('add', self(1), lit(2)), registry).type).toBe('number');
    expect(inferType(op('add', self(2), self(2)), registry).type).toBe('money');
    expect(inferType(op('mul', self(2), lit(2)), registry).type).toBe('money');
    expect(inferType(op('concat', self(1), self(3)), registry).type).toBe('string');
    expect(inferType(op('gt', self(1), lit(0)), registry).type).toBe('boolean');
  });

  it('несовместимая арифметика — type_mismatch', () => {
    const result = inferType(op('add', self(2), self(1)), registry);
    expect(result.type).toBeNull();
    expect(result.issues.some((issue) => issue.code === 'type_mismatch')).toBe(true);
  });

  it('ЕСЛИ требует одинаковые ветви', () => {
    const ast: FormulaNode = {
      kind: 'call',
      fn: 'if',
      args: [lit(true), self(1), self(3)],
    };
    expect(inferType(ast, registry).issues.some((issue) => issue.code === 'type_mismatch')).toBe(
      true,
    );
  });

  it('УНИКАЛЬНЫЕ даёт список, СУММА по тексту — ошибка', () => {
    const unique: FormulaNode = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'unique',
      field: 4,
    };
    expect(inferType(unique, registry).type).toBe('list');
    const sumText: FormulaNode = { ...unique, fn: 'sum' };
    expect(
      inferType(sumText, registry).issues.some((issue) => issue.code === 'type_mismatch'),
    ).toBe(true);
  });

  it('удалённый атрибут — неблокирующая проблема', () => {
    const result = inferType(self(99), registry);
    expect(result.type).toBeNull();
    expect(result.issues[0]?.code).toBe('attribute_deleted');
  });
});

describe('validateFormula: сохранение', () => {
  const registry = meta([1, 'number'], [2, 'text']);

  it('формула типа запрещает связанные записи и цепочку папок', () => {
    const ast: FormulaNode = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'count',
    };
    const result = validateFormula(ast, { hostKind: 'task', meta: registry, typeDefault: true });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'type_default_forbidden')).toBe(true);
  });

  it('источник письма ограничен матрицей', () => {
    const ast: FormulaNode = { kind: 'field', source: { kind: 'project' }, number: 1 };
    const result = validateFormula(ast, { hostKind: 'letter', meta: registry });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'source_forbidden')).toBe(true);
  });

  it('результат обязан подходить к типу атрибута', () => {
    const result = validateFormula(lit('строка'), {
      hostKind: 'task',
      meta: registry,
      targetFieldType: 'number',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'type_mismatch' && issue.blocking)).toBe(
      true,
    );
  });

  it('текстовое поле принимает число', () => {
    const result = validateFormula(lit(5), {
      hostKind: 'task',
      meta: registry,
      targetFieldType: 'text',
    });
    expect(result.ok).toBe(true);
    expect(result.type).toBe('number');
  });

  it('удалённый атрибут не блокирует сохранение', () => {
    const result = validateFormula(self(99), { hostKind: 'task', meta: registry });
    expect(result.ok).toBe(true);
    expect(
      result.issues.some((issue) => issue.code === 'attribute_deleted' && !issue.blocking),
    ).toBe(true);
  });
});

describe('extractDeps', () => {
  it('собирает значения, компанию, проект и выборки без дублей', () => {
    const ast: FormulaNode = {
      kind: 'op',
      op: 'add',
      args: [
        self(1),
        self(1),
        { kind: 'field', source: { kind: 'company' }, number: 2 },
        { kind: 'field', source: { kind: 'project' }, number: 3 },
        {
          kind: 'aggregate',
          from: {
            kind: 'related',
            selector: { kind: 'relations', relation: 'blocks', direction: 'out' },
          },
          fn: 'sum',
          field: 4,
        },
      ],
    };
    expect(extractDeps(ast)).toEqual([
      { kind: 'value', number: 1 },
      { kind: 'company', number: 2 },
      { kind: 'project', number: 3 },
      { kind: 'related', selector: 'relations', number: 4 },
    ]);
  });
});
