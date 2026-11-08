import {
  FORMULA_AGGREGATE_BY_ID,
  FORMULA_FUNCTION_BY_ID,
  FORMULA_SYSTEM_FIELD_BY_KEY,
  type CustomFieldType,
  type FormulaNode,
  type FormulaValueType,
} from '@nodus/contracts';

import type { FormulaRegistryMeta, FormulaTypeIssue, FormulaTypeResult } from './types.js';

/** Типы, для которых определено сравнение порядка (МИН/МАКС). */
const ORDERED_TYPES = new Set<FormulaValueType>(['number', 'money', 'date', 'datetime', 'string']);

/** Тип значения атрибута в языке формул: продолжительность — минуты (number),
 *  ссылки — id (ref), списки — массив id (list), текст/ссылка-путь — string. */
export function formulaTypeOfField(type: CustomFieldType): FormulaValueType {
  switch (type) {
    case 'counter':
    case 'text':
    case 'long_text':
    case 'link':
    case 'enum':
      // Счётчик (#630) — номер-строка: выдан движком, в формулах не считается.
      return 'string';
    case 'number':
    case 'duration':
      return 'number';
    case 'money':
      return 'money';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'bool':
      return 'boolean';
    case 'multienum':
    case 'users':
      return 'list';
    case 'user':
    case 'department':
    case 'project':
    case 'counterparty':
    case 'task':
    case 'letter':
    case 'node':
      return 'ref';
  }
}

function issue(
  issues: FormulaTypeIssue[],
  code: FormulaTypeIssue['code'],
  path: string,
  message: string,
  number?: number,
): null {
  issues.push({ code, path, message, ...(number === undefined ? {} : { number }) });
  return null;
}

/** Совместимость аргумента с ожидаемым типом. `string` принимает любой
 *  скаляр (текстовые функции Excel приводят число/флаг к тексту); `date`
 *  принимает и `datetime`; null — тип неизвестен, проверка откладывается. */
function accepts(expected: FormulaValueType, actual: FormulaValueType | null): boolean {
  if (actual === null || actual === expected) return true;
  if (expected === 'string') {
    return (
      actual === 'number' ||
      actual === 'boolean' ||
      actual === 'date' ||
      actual === 'datetime' ||
      actual === 'money' ||
      actual === 'ref' ||
      actual === 'list'
    );
  }
  if (expected === 'date' && actual === 'datetime') return true;
  return false;
}

function comparable(left: FormulaValueType | null, right: FormulaValueType | null): boolean {
  if (left === null || right === null) return true;
  return left === right;
}

function ordered(left: FormulaValueType | null, right: FormulaValueType | null): boolean {
  if (!comparable(left, right)) return false;
  return (
    left === null ||
    left === 'number' ||
    left === 'string' ||
    left === 'date' ||
    left === 'datetime' ||
    left === 'money'
  );
}

function numericBinary(
  op: 'add' | 'sub' | 'mul' | 'div',
  left: FormulaValueType | null,
  right: FormulaValueType | null,
  path: string,
  issues: FormulaTypeIssue[],
): FormulaValueType | null {
  if (left === null || right === null) return null;
  const bothNumber = left === 'number' && right === 'number';
  const bothMoney = left === 'money' && right === 'money';
  switch (op) {
    case 'add':
    case 'sub':
      if (bothNumber) return 'number';
      if (bothMoney) return 'money';
      return issue(issues, 'type_mismatch', path, `${op} needs two numbers or two money values`);
    case 'mul':
      if (bothNumber) return 'number';
      if ((left === 'money' && right === 'number') || (left === 'number' && right === 'money')) {
        return 'money';
      }
      return issue(issues, 'type_mismatch', path, 'money can be multiplied only by a number');
    case 'div':
      if (bothNumber) return 'number';
      if (left === 'money' && right === 'number') return 'money';
      if (bothMoney) return 'number';
      return issue(issues, 'type_mismatch', path, 'division needs a number or same-currency money');
  }
}

function inferNode(
  node: FormulaNode,
  meta: FormulaRegistryMeta,
  path: string,
  issues: FormulaTypeIssue[],
): FormulaValueType | null {
  switch (node.kind) {
    case 'literal':
      if (typeof node.value === 'number') return 'number';
      if (typeof node.value === 'boolean') return 'boolean';
      return 'string';
    case 'field': {
      const field = meta.byNumber.get(node.number);
      if (!field) {
        return issue(
          issues,
          'attribute_deleted',
          path,
          `attribute ${node.number} is deleted`,
          node.number,
        );
      }
      return formulaTypeOfField(field.type);
    }
    case 'system': {
      const spec = FORMULA_SYSTEM_FIELD_BY_KEY.get(`${node.entity}:${node.key}`);
      if (!spec)
        return issue(
          issues,
          'type_mismatch',
          path,
          `unknown system field ${node.entity}:${node.key}`,
        );
      return spec.type;
    }
    case 'op': {
      const types = node.args.map((arg, index) =>
        inferNode(arg, meta, `${path}.args.${index}`, issues),
      );
      const [left = null, right = null] = types;
      switch (node.op) {
        case 'concat':
          return 'string';
        case 'eq':
        case 'ne':
          if (!comparable(left, right)) {
            return issue(issues, 'type_mismatch', path, 'comparison of different types');
          }
          return 'boolean';
        case 'lt':
        case 'le':
        case 'gt':
        case 'ge':
          if (!ordered(left, right)) {
            return issue(issues, 'type_mismatch', path, 'ordering of incompatible types');
          }
          return 'boolean';
        case 'add':
        case 'sub':
        case 'mul':
        case 'div':
          return numericBinary(node.op, left, right, path, issues);
        default:
          return null;
      }
    }
    case 'call': {
      const spec = FORMULA_FUNCTION_BY_ID.get(node.fn);
      if (!spec) {
        return issue(issues, 'type_mismatch', path, `unknown function ${node.fn}`);
      }
      if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
        return issue(issues, 'arity', path, `${node.fn} has wrong argument count`);
      }
      const types = node.args.map((arg, index) =>
        inferNode(arg, meta, `${path}.args.${index}`, issues),
      );
      if (node.fn === 'if') {
        const [condition = null, whenTrue = null, whenFalse = null] = types;
        if (!accepts('boolean', condition)) {
          issue(issues, 'type_mismatch', `${path}.args.0`, 'condition must be boolean');
        }
        if (whenTrue !== null && whenFalse !== null && whenTrue !== whenFalse) {
          return issue(issues, 'type_mismatch', path, 'branches of ЕСЛИ must have the same type');
        }
        return whenTrue ?? whenFalse;
      }
      types.forEach((type, index) => {
        const expected = spec.args[Math.min(index, spec.args.length - 1)]!;
        if (!accepts(expected, type)) {
          issue(
            issues,
            'type_mismatch',
            `${path}.args.${index}`,
            `${node.fn} expects ${expected}, got ${type}`,
          );
        }
      });
      return spec.result === 'arg2' ? (types[1] ?? null) : spec.result;
    }
    case 'aggregate': {
      const spec = FORMULA_AGGREGATE_BY_ID.get(node.fn);
      if (!spec) {
        return issue(issues, 'type_mismatch', path, `unknown aggregate ${node.fn}`);
      }
      if (node.filter) {
        const filterType = inferNode(node.filter, meta, `${path}.filter`, issues);
        if (!accepts('boolean', filterType)) {
          issue(issues, 'type_mismatch', `${path}.filter`, 'aggregate condition must be boolean');
        }
      }
      if (node.field === undefined) return spec.result === 'field' ? null : spec.result;
      const field = meta.byNumber.get(node.field);
      if (!field) {
        issue(issues, 'attribute_deleted', path, `attribute ${node.field} is deleted`, node.field);
        return null;
      }
      const fieldType = formulaTypeOfField(field.type);
      switch (node.fn) {
        case 'sum':
        case 'avg':
          if (fieldType === 'money') return 'money';
          if (fieldType === 'number') return 'number';
          return issue(
            issues,
            'type_mismatch',
            path,
            `${node.fn} works only with numbers or money`,
          );
        case 'unique':
          if (fieldType === 'list') {
            return issue(issues, 'type_mismatch', path, 'unique works only with scalar fields');
          }
          return 'list';
        case 'every':
        case 'some':
        case 'count':
          return spec.result === 'field' ? fieldType : spec.result;
        case 'last':
          return fieldType;
        case 'min':
        case 'max':
          if (!ORDERED_TYPES.has(fieldType)) {
            return issue(issues, 'type_mismatch', path, `${node.fn} needs an ordered field`);
          }
          return fieldType;
      }
    }
  }
}

/**
 * Статический тайпинг формулы (Р2): тип каждого узла выводится без
 * вычисления по каталогу функций и реестру атрибутов. Неизвестный атрибут
 * даёт `attribute_deleted` — формула сохраняется, ячейка покажет ошибку.
 */
export function inferType(ast: FormulaNode, meta: FormulaRegistryMeta): FormulaTypeResult {
  const issues: FormulaTypeIssue[] = [];
  const type = inferNode(ast, meta, '', issues);
  return { type, issues };
}
