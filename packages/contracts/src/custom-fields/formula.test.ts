import { describe, expect, it } from 'vitest';

import { formulaNodeSchema, type FormulaNode, type FormulaSource } from './formula.js';
import { checkFormulaShape, formulaAttributeNumbers } from './formula-validation.js';
import { formulaToText } from './formula-text.js';
import { creationFormSchema } from '../workflows/creation-form.js';
import { fieldFormSlotSchema } from './field-form.schemas.js';
import { transitionFormSchema } from '../workflows/transition-form.schemas.js';

const field = (number: number, source: FormulaSource = { kind: 'self' }): FormulaNode => ({
  kind: 'field',
  source,
  number,
  name: `Атрибут ${number}`,
});

const cipher: FormulaNode = {
  kind: 'op',
  op: 'concat',
  args: [
    field(1, { kind: 'project' }),
    { kind: 'literal', value: '-' },
    field(2, { kind: 'folder_nearest', kindId: '00000000-0000-4000-8000-000000000001' }),
    { kind: 'literal', value: '-' },
    field(3),
    field(4),
  ],
};

describe('AST формулы (#632)', () => {
  it('формула шифра разбирается схемой', () => {
    expect(formulaNodeSchema.safeParse(cipher).success).toBe(true);
  });

  it('неизвестный узел отвергается', () => {
    expect(formulaNodeSchema.safeParse({ kind: 'nope' }).success).toBe(false);
  });

  it('depth-bomb не роняет парсер: ast_invalid вместо RangeError', () => {
    let bomb: unknown = { kind: 'literal', value: 1 };
    for (let index = 0; index < 5000; index += 1) {
      bomb = { kind: 'op', op: 'add', args: [bomb, { kind: 'literal', value: 1 }] };
    }
    expect(() => formulaNodeSchema.safeParse(bomb)).not.toThrow();
    expect(formulaNodeSchema.safeParse(bomb).success).toBe(false);
    expect(checkFormulaShape(bomb, 'task')[0]?.code).toBe('ast_invalid');
  });

  it('формула шифра проходит структурную проверку', () => {
    expect(checkFormulaShape(cipher, 'task')).toEqual([]);
  });

  it('источники ограничены матрицей носителя', () => {
    const projectField: FormulaNode = { kind: 'field', source: { kind: 'project' }, number: 1 };
    expect(
      checkFormulaShape(projectField, 'letter').some((i) => i.code === 'source_forbidden'),
    ).toBe(true);
  });

  it('связанные записи и цепочка папок недопустимы в узле значения', () => {
    const related: FormulaNode = {
      kind: 'field',
      source: { kind: 'related', selector: { kind: 'subtasks' } },
      number: 1,
    };
    expect(checkFormulaShape(related, 'task').some((i) => i.code === 'source_forbidden')).toBe(
      true,
    );
    const chain: FormulaNode = {
      kind: 'field',
      source: { kind: 'folder_chain', kindId: '00000000-0000-4000-8000-000000000001' },
      number: 1,
    };
    expect(checkFormulaShape(chain, 'task').some((i) => i.code === 'source_forbidden')).toBe(true);
  });

  it('формула типа запрещает related и цепочку папок', () => {
    const aggregate: FormulaNode = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'count',
    };
    expect(
      checkFormulaShape(aggregate, 'task', { typeDefault: true }).some(
        (i) => i.code === 'type_default_forbidden',
      ),
    ).toBe(true);
  });

  it('лимит глубины', () => {
    let node: FormulaNode = { kind: 'literal', value: 1 };
    for (let index = 0; index < 13; index += 1) {
      node = { kind: 'call', fn: 'abs', args: [node] };
    }
    expect(checkFormulaShape(node, 'task').some((i) => i.code === 'depth')).toBe(true);
  });

  it('лимит узлов', () => {
    const args = Array.from({ length: 10 }, () => ({ kind: 'literal' as const, value: 1 }));
    let node: FormulaNode = { kind: 'op', op: 'concat', args };
    for (let index = 0; index < 5; index += 1) {
      node = { kind: 'op', op: 'concat', args: [node, node] };
    }
    expect(checkFormulaShape(node, 'task').some((i) => i.code === 'nodes')).toBe(true);
  });

  it('лимит источников', () => {
    const args = Array.from({ length: 10 }, (_, index) => field(index + 1));
    const node: FormulaNode = { kind: 'op', op: 'concat', args };
    expect(checkFormulaShape(node, 'task').some((i) => i.code === 'sources')).toBe(true);
  });

  it('длинный литерал — ошибка', () => {
    const node: FormulaNode = { kind: 'literal', value: 'x'.repeat(501) };
    expect(checkFormulaShape(node, 'task').some((i) => i.code === 'literal_text')).toBe(true);
  });

  it('арность функций и агрегатов проверяется', () => {
    const call: FormulaNode = { kind: 'call', fn: 'abs', args: [] };
    expect(checkFormulaShape(call, 'task').some((i) => i.code === 'arity')).toBe(true);
    const every: FormulaNode = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'every',
    };
    expect(checkFormulaShape(every, 'task').some((i) => i.code === 'aggregate_field')).toBe(true);
  });

  it('номера атрибутов собираются для usage и плашек', () => {
    expect(formulaAttributeNumbers(cipher)).toEqual([1, 2, 3, 4]);
    const ref: FormulaNode = {
      kind: 'field',
      source: { kind: 'ref_field', field: 7 },
      number: 8,
    };
    expect(formulaAttributeNumbers(ref)).toEqual([7, 8]);
  });

  it('текстовое представление стабильно', () => {
    expect(formulaToText(cipher, (number, fallback) => fallback ?? `#${number}`)).toContain(
      'Атрибут 1',
    );
  });
});

describe('слоты с формулой (#632, Р6/Р12)', () => {
  it('слот вида/типа проекта принимает формулу и null', () => {
    expect(
      fieldFormSlotSchema.safeParse({
        fieldId: '00000000-0000-4000-8000-000000000001',
        state: 'optional',
        formula: null,
      }).success,
    ).toBe(true);
    expect(
      fieldFormSlotSchema.safeParse({
        fieldId: '00000000-0000-4000-8000-000000000001',
        state: 'optional',
        formula: cipher,
      }).success,
    ).toBe(true);
  });

  it('слот формы создания принимает формулу', () => {
    const form = {
      fields: [
        {
          key: 'cf.00000000-0000-4000-8000-000000000001',
          label: null,
          required: false,
          preset: null,
          formula: cipher,
        },
      ],
      chips: [],
    };
    expect(creationFormSchema.safeParse(form).success).toBe(true);
  });

  it('окно перехода: формула привязана к полю раздела', () => {
    const form = {
      enabled: true,
      sections: [
        {
          kind: 'fields',
          fields: ['cf.00000000-0000-4000-8000-000000000001'],
          formulas: { 'cf.00000000-0000-4000-8000-000000000001': cipher },
        },
      ],
    };
    expect(transitionFormSchema.safeParse(form).success).toBe(true);
    const foreign = {
      enabled: true,
      sections: [
        {
          kind: 'fields',
          fields: ['description'],
          formulas: { 'cf.00000000-0000-4000-8000-000000000001': cipher },
        },
      ],
    };
    expect(transitionFormSchema.safeParse(foreign).success).toBe(false);
  });
});
