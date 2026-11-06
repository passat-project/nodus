import type { FormulaNode } from '@nodus/contracts';

import { evaluateAggregate } from './evaluate-aggregate.js';
import { evaluateCall } from './evaluate-call.js';
import { arithmetic, asText, compareValues, fail, RuntimeFailure } from './runtime.js';
import type {
  FormulaCellError,
  FormulaEvaluation,
  FormulaResolver,
  FormulaValue,
} from './types.js';

/** Чистое вычисление AST формулы (#632): ошибка ячейки — результатом, не
 *  исключением; null-семантика и деньги — `runtime.ts`, функции и агрегаты —
 *  отдельными модулями. */

function evaluateOperation(
  node: Extract<FormulaNode, { kind: 'op' }>,
  resolver: FormulaResolver,
): FormulaValue {
  if (node.op === 'concat') {
    // «&» — склейка N операндов (редактор строит один узел из плашек подряд);
    // пустые операнды пропускаются.
    return node.args
      .map((arg) => evaluateNode(arg, resolver))
      .map((value) => (value === null ? '' : asText(value)))
      .join('');
  }
  const [leftNode, rightNode] = node.args;
  if (!leftNode || !rightNode) fail('type_mismatch', 'operator expects two arguments');
  const left = evaluateNode(leftNode, resolver);
  const right = evaluateNode(rightNode, resolver);
  switch (node.op) {
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
      return arithmetic(node.op, left, right);
    case 'eq':
    case 'ne':
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge':
      if (left === null || right === null) return false;
      return compareValues(left, right, node.op);
  }
}

function evaluateNode(node: FormulaNode, resolver: FormulaResolver): FormulaValue {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'field': {
      if (node.source.kind === 'related' || node.source.kind === 'folder_chain') {
        fail('source_unavailable', 'multi-valued source needs an aggregate', node.number);
      }
      const record = resolver.single(node.source);
      if (!record) fail('source_unavailable', 'formula source is not available', node.number);
      const value = record.value(node.number);
      return value === undefined ? null : value;
    }
    case 'op':
      return evaluateOperation(node, resolver);
    case 'call':
      return evaluateCall(node, resolver, evaluateNode);
    case 'aggregate':
      return evaluateAggregate(node, resolver, evaluateNode);
  }
}

function toCellError(error: unknown): FormulaCellError {
  if (error instanceof RuntimeFailure) {
    return {
      code: error.code,
      message: error.message,
      ...(error.number === undefined ? {} : { number: error.number }),
    };
  }
  return { code: 'eval_failed', message: 'formula evaluation failed' };
}

/**
 * Вычисление формулы (Р3): чистая функция над резолвером. Ошибка одной
 * ячейки возвращается результатом, а не исключением — работа не блокируется.
 * Пустой источник даёт null; арифметика с null → null; «&» пропускает null;
 * сравнение с null → false; агрегаты игнорируют null (кроме СКОЛЬКО).
 */
export function evaluate(ast: FormulaNode, resolver: FormulaResolver): FormulaEvaluation {
  try {
    return { value: evaluateNode(ast, resolver), error: null };
  } catch (error) {
    return { value: null, error: toCellError(error) };
  }
}
