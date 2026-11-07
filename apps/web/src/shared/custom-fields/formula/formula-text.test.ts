import { describe, expect, it } from 'vitest';
import type { FormulaNode } from '@nodus/contracts';

import { tokensToAst } from './formula-parser.js';
import {
  aggregateChipLabel,
  astToTokens,
  chipLabel,
  nextChipKey,
  type FormulaFieldChip,
} from './formula-text.js';

const field = (
  number: number,
  name: string,
  source: FormulaFieldChip['source'] = { kind: 'self' },
): FormulaNode => ({
  kind: 'field',
  source,
  number,
  name,
});

const cipher: FormulaNode = {
  kind: 'op',
  op: 'concat',
  args: [
    field(1, 'Шифр', { kind: 'project' }),
    { kind: 'literal', value: '-' },
    field(30, '№ по ГП', {
      kind: 'folder_nearest',
      kindId: '44000000-0000-4000-8000-000000000004',
    }),
    { kind: 'literal', value: '-' },
    field(27, 'Марка'),
    field(28, 'Номер комплекта'),
  ],
};

describe('formula-text: печать и разбор', () => {
  it('AST шифра печатается плашками и разбирается обратно', () => {
    const tokens = astToTokens(cipher);
    const chips = tokens.filter((token) => token.type !== 'text');
    expect(chips).toHaveLength(4);
    const result = tokensToAst(tokens);
    expect(result.error).toBeNull();
    expect(result.ast).toEqual(cipher);
  });

  it('приоритеты операторов сохраняются скобками', () => {
    const ast: FormulaNode = {
      kind: 'op',
      op: 'mul',
      args: [
        {
          kind: 'op',
          op: 'add',
          args: [
            { kind: 'literal', value: 1 },
            { kind: 'literal', value: 2 },
          ],
        },
        { kind: 'literal', value: 3 },
      ],
    };
    const result = tokensToAst(astToTokens(ast));
    expect(result.ast).toEqual(ast);
  });

  it('функции и строки в кавычках', () => {
    const ast: FormulaNode = {
      kind: 'call',
      fn: 'if',
      args: [
        {
          kind: 'op',
          op: 'gt',
          args: [
            { kind: 'literal', value: 1 },
            { kind: 'literal', value: 0 },
          ],
        },
        { kind: 'literal', value: 'да "кавычки"' },
        { kind: 'literal', value: 'нет' },
      ],
    };
    expect(tokensToAst(astToTokens(ast)).ast).toEqual(ast);
  });

  it('неявная склейка соседних операндов', () => {
    const result = tokensToAst([
      { type: 'text', text: '"ОВ"' },
      { type: 'field', key: nextChipKey(), number: 4, name: 'Номер', source: { kind: 'self' } },
    ]);
    expect(result.error).toBeNull();
    expect(result.ast).toEqual({
      kind: 'op',
      op: 'concat',
      args: [
        { kind: 'literal', value: 'ОВ' },
        { kind: 'field', source: { kind: 'self' }, number: 4, name: 'Номер' },
      ],
    });
  });

  it('склейка ниже арифметики: 1*2 & " руб" — умножение, затем текст', () => {
    const result = tokensToAst([{ type: 'text', text: '1*2 & " руб"' }]);
    expect(result.error).toBeNull();
    expect(result.ast).toEqual({
      kind: 'op',
      op: 'concat',
      args: [
        {
          kind: 'op',
          op: 'mul',
          args: [
            { kind: 'literal', value: 1 },
            { kind: 'literal', value: 2 },
          ],
        },
        { kind: 'literal', value: ' руб' },
      ],
    });
  });

  it('минус перед строковым литералом — разделитель склейки (шифр)', () => {
    const result = tokensToAst([{ type: 'text', text: '1 - "-" 2' }]);
    expect(result.error).toBeNull();
    expect(result.ast).toEqual({
      kind: 'op',
      op: 'concat',
      args: [
        { kind: 'literal', value: 1 },
        { kind: 'literal', value: '-' },
        { kind: 'literal', value: 2 },
      ],
    });
  });

  it('английское имя функции регистронезависимо', () => {
    expect(tokensToAst([{ type: 'text', text: 'if(1;2;3)' }]).error).toBeNull();
  });

  it('типографские операторы нормализуются', () => {
    expect(tokensToAst([{ type: 'text', text: '1 − 2' }]).error).toBeNull();
    expect(tokensToAst([{ type: 'text', text: '1 ≠ 2' }]).error).toBeNull();
  });

  it('пустая формула — null без ошибки', () => {
    expect(tokensToAst([{ type: 'text', text: '   ' }])).toEqual({ ast: null, error: null });
  });

  it('битая формула даёт человеческую ошибку', () => {
    const result = tokensToAst([{ type: 'text', text: '1 +' }]);
    expect(result.ast).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('неизвестная функция — ошибка', () => {
    expect(tokensToAst([{ type: 'text', text: 'НЕТТАКОЙ(1)' }]).error).toContain('НЕТТАКОЙ');
  });

  it('агрегат-плашка печатается подписью и переживает roundtrip', () => {
    const ast: FormulaNode = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'sum',
      field: 4,
    };
    const tokens = astToTokens(ast);
    const chip = tokens.find((token) => token.type === 'aggregate');
    expect(chip && chip.type === 'aggregate' ? aggregateChipLabel(chip) : '').toContain('СУММА');
    expect(tokensToAst(tokens).ast).toEqual(ast);
  });

  it('подпись плашки показывает источник', () => {
    expect(
      chipLabel({
        type: 'field',
        key: 'k',
        number: 1,
        name: 'Шифр',
        source: { kind: 'project' },
      }),
    ).toBe('Проект · Шифр');
  });
});
