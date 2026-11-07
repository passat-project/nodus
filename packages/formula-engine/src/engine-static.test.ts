import { describe, expect, it } from 'vitest';
import type { CustomFieldType, FormulaNode, FormulaSource } from '@nodus/contracts';

import { extractDeps } from './deps.js';
import { formulaTypeOfField, inferType } from './infer-type.js';
import { lit, meta, op, self } from './test-kit.js';

/** Статический слой движка (#632): зависимости формулы (extractDeps) и
 *  вывод типа (inferType/formulaTypeOfField) — ветви источников, каталогов
 *  функций/агрегатов и ошибок совместимости без вычисления. */

const BY_ID = '00000000-0000-4000-8000-00000000000';

const field = (source: FormulaSource, number = 1): FormulaNode => ({
  kind: 'field',
  source,
  number,
  name: 'Атрибут',
});

const system = (source: FormulaSource, key = 'number'): FormulaNode => ({
  kind: 'system',
  source,
  entity: 'task',
  key,
});

const aggregate = (parts: Partial<Extract<FormulaNode, { kind: 'aggregate' }>>): FormulaNode =>
  ({
    kind: 'aggregate',
    from: { kind: 'related', selector: { kind: 'subtasks' } },
    fn: 'count',
    ...parts,
  }) as FormulaNode;

describe('extractDeps: источники одного значения', () => {
  it('self/родитель/проект/компания — свои виды зависимостей', () => {
    expect(extractDeps(field({ kind: 'self' }, 3))).toEqual([{ kind: 'value', number: 3 }]);
    expect(extractDeps(field({ kind: 'parent_task' }, 4))).toEqual([{ kind: 'parent', number: 4 }]);
    expect(extractDeps(field({ kind: 'project' }, 5))).toEqual([{ kind: 'project', number: 5 }]);
    expect(extractDeps(field({ kind: 'company' }, 6))).toEqual([{ kind: 'company', number: 6 }]);
  });

  it('ссылка и ближайшая папка несут адрес зависимости', () => {
    expect(extractDeps(field({ kind: 'ref_field', field: 7 }, 8))).toEqual([
      { kind: 'ref', refField: 7, number: 8 },
    ]);
    expect(extractDeps(field({ kind: 'folder_nearest', kindId: BY_ID }, 9))).toEqual([
      { kind: 'folder', kindId: BY_ID, number: 9 },
    ]);
  });

  it('многозначные источники вне агрегата зависимости не дают (shape их запрещает)', () => {
    expect(extractDeps(field({ kind: 'folder_chain', kindId: BY_ID }, 1))).toEqual([]);
    expect(extractDeps(field({ kind: 'related', selector: { kind: 'subtasks' } }, 1))).toEqual([]);
  });

  it('системные поля: обычное — система, в фильтре агрегата — выборка', () => {
    expect(extractDeps(system({ kind: 'self' }))).toEqual([{ kind: 'system' }]);
    expect(extractDeps(system({ kind: 'ref_field', field: 7 }))).toEqual([
      { kind: 'system', refField: 7 },
    ]);
    expect(extractDeps(system({ kind: 'self' }, 'title') as never)).toEqual([{ kind: 'system' }]);
    const withFilter = aggregate({ filter: op('gt', self(2), lit(0)) });
    expect(extractDeps(withFilter)).toEqual([
      { kind: 'related', selector: 'subtasks' },
      { kind: 'selection', number: 2 },
    ]);
  });

  it('дубликаты схлопываются, литерал зависимости не создаёт', () => {
    expect(extractDeps(op('add', self(1), self(1)))).toEqual([{ kind: 'value', number: 1 }]);
    expect(extractDeps(lit(5))).toEqual([]);
    expect(extractDeps({ kind: 'call', fn: 'len', args: [self(1)] })).toEqual([
      { kind: 'value', number: 1 },
    ]);
  });

  it('агрегаты: цепочка папок, связи с видом и направлением, задачи папки', () => {
    expect(
      extractDeps(
        aggregate({
          fn: 'sum',
          from: { kind: 'folder_chain', kindId: BY_ID },
          field: 3,
        }),
      ),
    ).toEqual([{ kind: 'folder', kindId: BY_ID, number: 3 }]);
    expect(
      extractDeps(
        aggregate({
          from: {
            kind: 'related',
            selector: { kind: 'relations', relation: 'blocks', direction: 'out' },
          },
        }),
      ),
    ).toEqual([{ kind: 'related', selector: 'relations', relation: 'blocks', direction: 'out' }]);
    expect(
      extractDeps(
        aggregate({
          fn: 'last',
          from: { kind: 'related', selector: { kind: 'node_tasks' } },
          field: 2,
        }),
      ),
    ).toEqual([{ kind: 'node_tasks', selector: 'node_tasks', number: 2 }]);
  });
});

describe('inferType: типы атрибутов и системные поля', () => {
  it('форма значения каждого типа атрибута', () => {
    const cases: [CustomFieldType, string][] = [
      ['text', 'string'],
      ['long_text', 'string'],
      ['link', 'string'],
      ['enum', 'string'],
      ['number', 'number'],
      ['duration', 'number'],
      ['money', 'money'],
      ['date', 'date'],
      ['datetime', 'datetime'],
      ['bool', 'boolean'],
      ['multienum', 'list'],
      ['users', 'list'],
      ['user', 'ref'],
      ['department', 'ref'],
      ['project', 'ref'],
      ['counterparty', 'ref'],
      ['task', 'ref'],
      ['letter', 'ref'],
      ['node', 'ref'],
    ];
    for (const [type, expected] of cases) expect(formulaTypeOfField(type)).toBe(expected);
  });

  it('литералы и системные поля каталога', () => {
    const registry = meta();
    expect(inferType(lit(true), registry).type).toBe('boolean');
    expect(inferType(lit('x'), registry).type).toBe('string');
    expect(inferType(system({ kind: 'self' }), registry).type).toBe('number');
    const unknown = inferType(system({ kind: 'self' }, 'nope'), registry);
    expect(unknown.type).toBeNull();
    expect(unknown.issues[0]?.code).toBe('type_mismatch');
  });
});

describe('inferType: операторы и функции', () => {
  const registry = meta(
    [1, 'number'],
    [2, 'money'],
    [3, 'text'],
    [4, 'bool'],
    [5, 'date'],
    [6, 'enum'],
    [7, 'multienum'],
  );

  it('арифметика выводит тип, несовместимости — type_mismatch', () => {
    expect(inferType(op('concat', self(3), lit('-')), registry).type).toBe('string');
    expect(inferType(op('mul', self(2), lit(2)), registry).type).toBe('money');
    expect(inferType(op('div', self(2), lit(2)), registry).type).toBe('money');
    expect(inferType(op('div', self(2), self(2)), registry).type).toBe('number');
    const mixed = inferType(op('add', self(1), self(2)), registry);
    expect(mixed.type).toBeNull();
    expect(mixed.issues[0]?.code).toBe('type_mismatch');
  });

  it('сравнения: разные типы и неупорядоченные — ошибка', () => {
    expect(inferType(op('gt', self(1), lit(0)), registry).type).toBe('boolean');
    const different = inferType(op('eq', self(1), self(3)), registry);
    expect(different.issues[0]?.code).toBe('type_mismatch');
    const unordered = inferType(op('lt', self(4), self(4)), registry);
    expect(unordered.issues[0]?.code).toBe('type_mismatch');
  });

  it('ЕСЛИ: условие-флаг, ветви одного типа, null-ветвь не мешает', () => {
    const badCondition = inferType(
      { kind: 'call', fn: 'if', args: [lit('x'), lit(1), lit(2)] },
      registry,
    );
    expect(badCondition.issues[0]?.code).toBe('type_mismatch');
    const unknownBranch = inferType(
      { kind: 'call', fn: 'if', args: [lit(true), self(9), lit(2)] },
      registry,
    );
    expect(unknownBranch.type).toBe('number');
    expect(unknownBranch.issues.some((issue) => issue.code === 'attribute_deleted')).toBe(true);
  });

  it('арность — ошибка, текстовые функции принимают числа приведением', () => {
    const arity = inferType({ kind: 'call', fn: 'abs', args: [lit(1), lit(2)] }, registry);
    expect(arity.issues[0]?.code).toBe('arity');
    expect(inferType({ kind: 'call', fn: 'len', args: [lit(5)] }, registry).issues).toEqual([]);
    expect(inferType({ kind: 'call', fn: 'text', args: [lit(5), lit('0')] }, registry).type).toBe(
      'string',
    );
  });
});

describe('inferType: агрегаты', () => {
  const registry = meta(
    [1, 'number'],
    [2, 'money'],
    [3, 'text'],
    [4, 'bool'],
    [5, 'date'],
    [6, 'enum'],
    [7, 'multienum'],
  );

  it('без поля — тип каталога; СКОЛЬКО — число, ВСЕ/ХОТЯ БЫ ОДНА — флаг', () => {
    expect(inferType(aggregate({ fn: 'count' }), registry).type).toBe('number');
    expect(inferType(aggregate({ fn: 'every', filter: lit(true) }), registry).type).toBe('boolean');
    const withoutField = inferType(aggregate({ fn: 'last' }), registry);
    expect(withoutField.type).toBeNull();
  });

  it('агрегат по полю: тип поля, суммы/среднее — только числа и деньги', () => {
    expect(inferType(aggregate({ fn: 'last', field: 1 }), registry).type).toBe('number');
    expect(inferType(aggregate({ fn: 'sum', field: 2 }), registry).type).toBe('money');
    expect(inferType(aggregate({ fn: 'avg', field: 1 }), registry).type).toBe('number');
    const textSum = inferType(aggregate({ fn: 'sum', field: 3 }), registry);
    expect(textSum.issues[0]?.code).toBe('type_mismatch');
  });

  it('УНИКАЛЬНЫЕ — список со скаляра, список — ошибка; МИН/МАКС — упорядоченные', () => {
    expect(inferType(aggregate({ fn: 'unique', field: 6 }), registry).type).toBe('list');
    const listUnique = inferType(aggregate({ fn: 'unique', field: 7 }), registry);
    expect(listUnique.issues[0]?.code).toBe('type_mismatch');
    expect(inferType(aggregate({ fn: 'min', field: 5 }), registry).type).toBe('date');
    expect(inferType(aggregate({ fn: 'max', field: 1 }), registry).type).toBe('number');
    const boolMin = inferType(aggregate({ fn: 'min', field: 4 }), registry);
    expect(boolMin.issues[0]?.code).toBe('type_mismatch');
  });

  it('фильтр-не-флаг и неизвестный агрегат — type_mismatch', () => {
    const badFilter = inferType(aggregate({ fn: 'count', filter: lit(1) }), registry);
    expect(badFilter.issues[0]?.code).toBe('type_mismatch');
    const unknown = inferType(aggregate({ fn: 'nope' as never }), registry);
    expect(unknown.issues[0]?.code).toBe('type_mismatch');
    const deleted = inferType(aggregate({ fn: 'sum', field: 9 }), registry);
    expect(deleted.issues[0]?.code).toBe('attribute_deleted');
  });
});
