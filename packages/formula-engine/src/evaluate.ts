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
    // пустые операнды пропускаются. Литерал-разделитель (`"-"`, `"—"`…)
    // при пустом соседе тоже пропускается: пустое значение не оставляет
    // висячих дефисов (`Шифр-№` при пустом № = `Шифр`, а не `Шифр--`).
    const texts = node.args.map((arg) => {
      const value = evaluateNode(arg, resolver);
      if (value === null) return '';
      // Литерал — это написанный руками текст: типографский разделитель `"—"`
      // не «пустой маркер», его нельзя прогонять через `textOf` — иначе
      // склейка молча теряет разделитель. Пустой маркер — только значение поля.
      if (arg.kind === 'literal' && typeof value === 'string') return value;
      return asText(value);
    });
    const separator = node.args.map(
      (arg, index) =>
        arg.kind === 'literal' &&
        typeof arg.value === 'string' &&
        texts[index] !== '' &&
        /^[-–—−]+$/.test(arg.value),
    );
    // Формула из одних литералов — текст как написан (`"-"` сам по себе —
    // литерал, а не разделитель). Если операнды-значения ЕСТЬ, но все пусты —
    // результат пуст: висячие разделители не собираются в дефис-маркер
    // «пусто» (`А & "-" & Б` при пустых А и Б = ``, а не `-`).
    if (node.args.every((arg) => arg.kind === 'literal')) {
      return texts.join('');
    }
    if (!texts.some((text, index) => !separator[index] && text !== '')) {
      return '';
    }
    const parts: string[] = [];
    for (let index = 0; index < texts.length; index += 1) {
      const text = texts[index]!;
      if (separator[index]) {
        const prev = texts[index - 1] ?? '';
        const next = texts[index + 1] ?? '';
        if (prev === '' || next === '') continue;
        parts.push(text);
        continue;
      }
      if (text !== '') parts.push(text);
    }
    return parts.join('');
  }
  // Арность проверяется до вычисления: лишний аргумент не должен молча
  // теряться (`add(1,2,3)` — ошибка формы, а не `3`).
  if (node.args.length !== 2) fail('type_mismatch', 'operator expects two arguments');
  const [leftNode, rightNode] = node.args as [FormulaNode, FormulaNode];
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
    case 'system': {
      if (node.source.kind === 'related' || node.source.kind === 'folder_chain') {
        fail('source_unavailable', 'system field needs a single record');
      }
      const record = resolver.single(node.source);
      if (!record) fail('source_unavailable', 'formula source is not available');
      const value = record.system?.(node.key);
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
