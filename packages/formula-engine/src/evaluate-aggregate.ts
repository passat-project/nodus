import { FORMULA_AGGREGATE_BY_ID, FORMULA_LIMITS, type FormulaNode } from '@nodus/contracts';

import {
  asBoolean,
  asNumber,
  asText,
  compareValues,
  fail,
  isMoney,
  moneyFromMinor,
  moneyMinor,
} from './runtime.js';
import type { FormulaRecord, FormulaResolver, FormulaSingleSource, FormulaValue } from './types.js';

/** Агрегаты выборок (#632): СКОЛЬКО/СУММА/ПОСЛЕДНЯЯ/УНИКАЛЬНЫЕ/МИН/МАКС/
 *  СРЗНАЧ и условия ВСЕ/ХОТЯ БЫ ОДНА; пустая выборка — нейтральное значение. */

function withSelf(resolver: FormulaResolver, record: FormulaRecord): FormulaResolver {
  return {
    single: (source: FormulaSingleSource) =>
      source.kind === 'self' ? record : resolver.single(source),
    select: (from) => resolver.select(from),
  };
}

function aggregateValues(records: readonly FormulaRecord[], field: number): FormulaValue[] {
  return records.map((record) => {
    const value = record.value(field);
    return value === undefined ? null : value;
  });
}

export function evaluateAggregate(
  node: Extract<FormulaNode, { kind: 'aggregate' }>,
  resolver: FormulaResolver,
  evaluateNode: (node: FormulaNode, resolver: FormulaResolver) => FormulaValue,
): FormulaValue {
  const spec = FORMULA_AGGREGATE_BY_ID.get(node.fn);
  if (!spec) fail('eval_failed', `unknown aggregate ${node.fn}`);
  const records = resolver.select(node.from);
  if (records.length > FORMULA_LIMITS.selection) {
    fail('selection_limit', 'aggregate selection is too large');
  }
  const matches = (record: FormulaRecord): boolean => {
    if (!node.filter) return true;
    return asBoolean(evaluateNode(node.filter, withSelf(resolver, record)));
  };
  if (node.fn === 'every') return records.every(matches);
  if (node.fn === 'some') return records.some(matches);
  const selected = node.filter ? records.filter(matches) : records;

  if (node.fn === 'count') return selected.length;

  if (node.field === undefined) {
    return fail('type_mismatch', `${node.fn} requires a field`);
  }
  const values = aggregateValues(selected, node.field).filter(
    (value): value is Exclude<FormulaValue, null> => value !== null,
  );

  switch (node.fn) {
    case 'last': {
      const lastRecord = selected[selected.length - 1];
      if (!lastRecord) return null;
      const value = lastRecord.value(node.field);
      return value === undefined ? null : value;
    }
    case 'unique': {
      const seen = new Set<string>();
      const result: string[] = [];
      for (const value of values) {
        const key = JSON.stringify(value);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(asText(value));
      }
      return result;
    }
    case 'min':
    case 'max': {
      if (values.length === 0) return null;
      let best = values[0]!;
      for (const value of values.slice(1)) {
        const greater = compareValues(value, best, 'gt');
        const replace = node.fn === 'max' ? greater : compareValues(value, best, 'lt');
        if (replace) best = value;
      }
      return best;
    }
    case 'sum':
    case 'avg': {
      if (values.length === 0) return node.fn === 'sum' ? 0 : null;
      const money = values.filter(isMoney);
      if (money.length > 0) {
        if (money.length !== values.length) fail('type_mismatch', 'mixed money and numbers');
        const currencyId = money[0]!.currencyId;
        if (money.some((value) => value.currencyId !== currencyId)) {
          fail('type_mismatch', 'money values have different currencies');
        }
        const total = money.reduce((sum, value) => sum + moneyMinor(value), 0);
        return moneyFromMinor(
          node.fn === 'sum' ? total : Math.round(total / money.length),
          currencyId,
        );
      }
      const numbers = values.map((value) => asNumber(value));
      const total = numbers.reduce((sum, value) => sum + value, 0);
      return node.fn === 'sum' ? total : total / numbers.length;
    }
  }
  return fail('eval_failed', 'unreachable aggregate branch');
}
