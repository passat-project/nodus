import { describe, expect, it } from 'vitest';

import type { FormulaNode, FormulaSource } from './formula.js';
import { formulaToText, isFormulaNode, parseFormula } from './formula-text.js';

/** Человекочитаемая запись формулы и разбор AST на границе HTTP/моков
 *  (#632): стабильная строка с русскими префиксами источников и честный
 *  отказ с причиной для ручного JSON. */

const labelOf = (number: number, fallback?: string): string => fallback ?? `№${number}`;

const field = (source: FormulaSource, number = 1, name = 'Шифр'): FormulaNode => ({
  kind: 'field',
  source,
  number,
  name,
});

describe('formulaToText: источники и узлы', () => {
  it('префиксы всех источников на русском', () => {
    expect(formulaToText(field({ kind: 'self' }), labelOf)).toBe('{Шифр}');
    expect(formulaToText(field({ kind: 'parent_task' }), labelOf)).toBe('Родитель · {Шифр}');
    expect(formulaToText(field({ kind: 'folder_nearest', kindId: 'k' }), labelOf)).toBe(
      'Папка · {Шифр}',
    );
    expect(formulaToText(field({ kind: 'folder_chain', kindId: 'k' }), labelOf)).toBe(
      'Цепочка папок · {Шифр}',
    );
    expect(formulaToText(field({ kind: 'project' }), labelOf)).toBe('Проект · {Шифр}');
    expect(formulaToText(field({ kind: 'company' }), labelOf)).toBe('Компания · {Шифр}');
    expect(formulaToText(field({ kind: 'ref_field', field: 7 }), labelOf)).toBe(
      'По ссылке · {Шифр}',
    );
    expect(formulaToText(field({ kind: 'related', selector: { kind: 'subtasks' } }), labelOf)).toBe(
      'Связанные · {Шифр}',
    );
  });

  it('литералы: строки в кавычках, числа и флаги как есть', () => {
    expect(formulaToText({ kind: 'literal', value: 2 }, labelOf)).toBe('2');
    expect(formulaToText({ kind: 'literal', value: true }, labelOf)).toBe('true');
    expect(formulaToText({ kind: 'literal', value: 'КЖ' }, labelOf)).toBe('"КЖ"');
  });

  it('операторы: символы между пробелами, склейка — без знака', () => {
    const two = (op: Extract<FormulaNode, { kind: 'op' }>['op']): string =>
      formulaToText(
        {
          kind: 'op',
          op,
          args: [
            { kind: 'literal', value: 1 },
            { kind: 'literal', value: 2 },
          ],
        },
        labelOf,
      );
    expect(two('add')).toBe('1 + 2');
    expect(two('sub')).toBe('1 - 2');
    expect(two('mul')).toBe('1 * 2');
    expect(two('div')).toBe('1 / 2');
    expect(two('eq')).toBe('1 = 2');
    expect(two('ne')).toBe('1 ≠ 2');
    expect(two('lt')).toBe('1 < 2');
    expect(two('le')).toBe('1 ≤ 2');
    expect(two('gt')).toBe('1 > 2');
    expect(two('ge')).toBe('1 ≥ 2');
    expect(two('concat')).toBe('1 2');
  });

  it('функции, системные поля и агрегаты', () => {
    expect(
      formulaToText(
        {
          kind: 'call',
          fn: 'if',
          args: [
            { kind: 'literal', value: true },
            { kind: 'literal', value: 1 },
          ],
        },
        labelOf,
      ),
    ).toBe('if(true; 1)');
    expect(
      formulaToText(
        { kind: 'system', source: { kind: 'self' }, entity: 'task', key: 'number' },
        labelOf,
      ),
    ).toBe('{task.number}');
    expect(
      formulaToText(
        {
          kind: 'aggregate',
          from: { kind: 'folder_chain', kindId: 'k' },
          fn: 'sum',
          field: 3,
        },
        labelOf,
      ),
    ).toBe('sum(цепочка папок; {№3})');
    expect(
      formulaToText(
        {
          kind: 'aggregate',
          from: { kind: 'related', selector: { kind: 'subtasks' } },
          fn: 'count',
        },
        labelOf,
      ),
    ).toBe('count(subtasks)');
  });
});

describe('parseFormula и isFormulaNode', () => {
  it('пустой ввод — нет AST и нет проблем', () => {
    expect(parseFormula(null)).toEqual({ ast: null, issues: [] });
    expect(parseFormula(undefined)).toEqual({ ast: null, issues: [] });
  });

  it('битый JSON — ast_invalid с причиной', () => {
    const broken = parseFormula({ kind: 'literal', value: [1] });
    expect(broken.ast).toBeNull();
    expect(broken.issues[0]?.code).toBe('ast_invalid');
  });

  it('валидный узел разбирается в AST; массив и мусор — не узел', () => {
    expect(parseFormula({ kind: 'literal', value: 1 }).ast).toEqual({ kind: 'literal', value: 1 });
    expect(isFormulaNode([{ kind: 'literal', value: 1 }])).toBe(false);
    expect(isFormulaNode({})).toBe(false);
    expect(isFormulaNode({ kind: 'literal', value: 'x' })).toBe(true);
    expect(isFormulaNode({ kind: 'literal', value: [] })).toBe(false);
  });
});
