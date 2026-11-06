import type { FormulaAggregateFrom, FormulaNode, FormulaSource } from '@nodus/contracts';

import type { FormulaFieldMeta, FormulaRecord, FormulaResolver, FormulaValue } from './types.js';

/** Фикстуры тестов движка: запись-значения, резолвер источников и выборок,
 *  короткие конструкторы AST. Не входит в сборку пакета. */

export function record(values: Record<number, FormulaValue>): FormulaRecord {
  return { value: (number) => values[number] };
}

export function resolver(opts: {
  self?: Record<number, FormulaValue>;
  parent?: Record<number, FormulaValue> | null;
  company?: Record<number, FormulaValue>;
  project?: Record<number, FormulaValue>;
  ref?: Record<number, FormulaValue> | null;
  selections?: Partial<Record<string, Record<number, FormulaValue>[]>>;
}): FormulaResolver {
  const single = (source: FormulaSource): FormulaRecord | null => {
    switch (source.kind) {
      case 'self':
        return record(opts.self ?? {});
      case 'parent_task':
        return opts.parent === undefined || opts.parent === null ? null : record(opts.parent);
      case 'company':
        return record(opts.company ?? {});
      case 'project':
        return record(opts.project ?? {});
      case 'ref_field':
        return opts.ref === undefined || opts.ref === null ? null : record(opts.ref);
      case 'folder_nearest':
        return record(opts.self ?? {});
      default:
        return null;
    }
  };
  return {
    single: single as FormulaResolver['single'],
    select: (from: FormulaAggregateFrom) => {
      if (from.kind === 'folder_chain') {
        return (opts.selections?.['chain'] ?? []).map(record);
      }
      const key =
        from.selector.kind === 'relations'
          ? `relations:${from.selector.relation}:${from.selector.direction}`
          : from.selector.kind;
      return (opts.selections?.[key] ?? []).map(record);
    },
  };
}

export const self = (number: number, name = 'Атрибут'): FormulaNode => ({
  kind: 'field',
  source: { kind: 'self' },
  number,
  name,
});

export const lit = (value: number | string | boolean): FormulaNode => ({ kind: 'literal', value });

export const op = (
  opName: Extract<FormulaNode, { kind: 'op' }>['op'],
  left: FormulaNode,
  right: FormulaNode,
): FormulaNode => ({
  kind: 'op',
  op: opName,
  args: [left, right],
});

export const meta = (
  ...fields: [number, FormulaFieldMeta['type']][]
): { byNumber: Map<number, FormulaFieldMeta> } => ({
  byNumber: new Map(fields.map(([number, type]) => [number, { number, type }])),
});
