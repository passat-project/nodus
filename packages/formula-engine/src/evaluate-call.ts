import { FORMULA_FUNCTION_BY_ID, type FormulaNode } from '@nodus/contracts';

import {
  asBoolean,
  asDate,
  asNumber,
  asText,
  fail,
  formatByPattern,
  roundDownAway,
  roundHalfAway,
  roundUpAway,
} from './runtime.js';
import type { FormulaResolver, FormulaValue } from './types.js';

/** Функции каталога V1 (#632): ленивое ЕСЛИ, логика, числа, текст, даты. */

export function evaluateCall(
  node: Extract<FormulaNode, { kind: 'call' }>,
  resolver: FormulaResolver,
  evaluateNode: (node: FormulaNode, resolver: FormulaResolver) => FormulaValue,
): FormulaValue {
  if (!FORMULA_FUNCTION_BY_ID.has(node.fn)) fail('eval_failed', `unknown function ${node.fn}`);
  const args = node.args;
  switch (node.fn) {
    case 'if': {
      const condition = asBoolean(args[0] ? evaluateNode(args[0], resolver) : null);
      const branch = condition ? args[1] : args[2];
      return branch ? evaluateNode(branch, resolver) : null;
    }
    case 'and': {
      let result = true;
      for (const arg of args) result = result && asBoolean(evaluateNode(arg, resolver));
      return result;
    }
    case 'or': {
      let result = false;
      for (const arg of args) result = result || asBoolean(evaluateNode(arg, resolver));
      return result;
    }
    case 'not':
      return !asBoolean(args[0] ? evaluateNode(args[0], resolver) : null);
    case 'len': {
      const value = args[0] ? evaluateNode(args[0], resolver) : null;
      return value === null ? 0 : asText(value).length;
    }
    case 'round':
    case 'roundup':
    case 'rounddown': {
      const value = args[0] ? evaluateNode(args[0], resolver) : null;
      if (value === null) return null;
      const digits = args[1] ? asNumber(evaluateNode(args[1], resolver)) : 0;
      const number = asNumber(value);
      if (node.fn === 'round') return roundHalfAway(number, digits);
      if (node.fn === 'roundup') return roundUpAway(number, digits);
      return roundDownAway(number, digits);
    }
    case 'abs': {
      const value = args[0] ? evaluateNode(args[0], resolver) : null;
      return value === null ? null : Math.abs(asNumber(value));
    }
    case 'left':
    case 'right': {
      const value = args[0] ? evaluateNode(args[0], resolver) : null;
      if (value === null) return null;
      const text = asText(value);
      const count = args[1] ? asNumber(evaluateNode(args[1], resolver)) : 1;
      const size = Math.max(0, Math.trunc(count));
      return node.fn === 'left' ? text.slice(0, size) : text.slice(Math.max(0, text.length - size));
    }
    case 'text': {
      const value = args[0] ? evaluateNode(args[0], resolver) : null;
      if (value === null) return null;
      const pattern = args[1] ? asText(evaluateNode(args[1], resolver)) : '';
      if (!/^[0#]+(\.[0#]+)?$/.test(pattern)) {
        fail('type_mismatch', 'ТЕКСТ expects a format like 00 or 0.00');
      }
      return formatByPattern(asNumber(value), pattern);
    }
    case 'year':
    case 'month':
    case 'day': {
      const value = args[0] ? evaluateNode(args[0], resolver) : null;
      if (value === null) return null;
      const date = asDate(value);
      if (node.fn === 'year') return date.getUTCFullYear();
      if (node.fn === 'month') return date.getUTCMonth() + 1;
      return date.getUTCDate();
    }
    case 'datedif': {
      const startValue = args[0] ? evaluateNode(args[0], resolver) : null;
      const endValue = args[1] ? evaluateNode(args[1], resolver) : null;
      if (startValue === null || endValue === null) return null;
      const start = asDate(startValue);
      const end = asDate(endValue);
      const unit = args[2] ? asText(evaluateNode(args[2], resolver)).toLowerCase() : 'days';
      switch (unit) {
        case 'days':
        case 'дни':
          return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
        case 'months':
        case 'месяцы': {
          const months =
            (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
            (end.getUTCMonth() - start.getUTCMonth()) -
            (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
          return months;
        }
        case 'years':
        case 'годы': {
          const months =
            (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
            (end.getUTCMonth() - start.getUTCMonth()) -
            (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
          return Math.trunc(months / 12);
        }
        default:
          return fail('type_mismatch', 'РАЗНДАТ expects days, months or years');
      }
    }
  }
}
