import {
  FORMULA_AGGREGATE_BY_ID,
  FORMULA_FUNCTION_BY_ID,
  FORMULA_LIMITS,
  FORMULA_RELATED_MATRIX,
  FORMULA_SINGLE_VALUE_SOURCES,
  FORMULA_SOURCE_MATRIX,
  FORMULA_TYPE_FORBIDDEN_SOURCES,
} from './formula-catalog.js';
import { formulaNodeSchema, type FormulaHostKind, type FormulaNode } from './formula.js';

/**
 * Структурная проверка формулы (одна для сервера и редактора): лимиты,
 * матрица источников, арность функций и агрегатов, форма литералов; плюс
 * сбор номеров атрибутов и человекочитаемая запись для превью/тестов.
 * Типы значений выводит движок (`@nodus/formula-engine`).
 */

/** Проблема формы формулы (до вычисления): код + путь узла + текст. */
export interface FormulaShapeIssue {
  code:
    | 'ast_invalid'
    | 'depth'
    | 'nodes'
    | 'sources'
    | 'literal_text'
    | 'arity'
    | 'source_forbidden'
    | 'selector_forbidden'
    | 'aggregate_field'
    | 'type_default_forbidden';
  /** Путь до узла (например `args.0.args.1`) — редактор подсвечивает плашку. */
  path: string;
  message: string;
}

function walk(
  node: FormulaNode,
  path: string,
  depth: number,
  hostKind: FormulaHostKind,
  issues: FormulaShapeIssue[],
  counters: { nodes: number; sources: number },
): void {
  counters.nodes += 1;
  if (depth > FORMULA_LIMITS.depth) {
    issues.push({
      code: 'depth',
      path,
      message: `formula nesting exceeds ${FORMULA_LIMITS.depth}`,
    });
    return;
  }
  switch (node.kind) {
    case 'literal':
      if (typeof node.value === 'string' && node.value.length > FORMULA_LIMITS.literalText) {
        issues.push({
          code: 'literal_text',
          path,
          message: `formula literal exceeds ${FORMULA_LIMITS.literalText} characters`,
        });
      }
      return;
    case 'field': {
      counters.sources += 1;
      if (!FORMULA_SINGLE_VALUE_SOURCES.includes(node.source.kind)) {
        issues.push({
          code: 'source_forbidden',
          path,
          message: `source ${node.source.kind} is multi-valued; use an aggregate`,
        });
        return;
      }
      const allowed = FORMULA_SOURCE_MATRIX[hostKind];
      if (!allowed.includes(node.source.kind)) {
        issues.push({
          code: 'source_forbidden',
          path,
          message: `source ${node.source.kind} is not available for ${hostKind}`,
        });
      }
      if (node.source.kind === 'related') {
        const selectors = FORMULA_RELATED_MATRIX[hostKind];
        if (!selectors.includes(node.source.selector.kind)) {
          issues.push({
            code: 'selector_forbidden',
            path,
            message: `selector ${node.source.selector.kind} is not available for ${hostKind}`,
          });
        }
      }
      return;
    }
    case 'op': {
      const arity = node.op === 'concat' ? { min: 2, max: 10 } : { min: 2, max: 2 };
      if (node.args.length < arity.min || node.args.length > arity.max) {
        issues.push({
          code: 'arity',
          path,
          message:
            node.op === 'concat'
              ? 'concatenation expects two to ten arguments'
              : 'operator expects two arguments',
        });
      }
      node.args.forEach((arg, index) =>
        walk(arg, `${path}.args.${index}`, depth + 1, hostKind, issues, counters),
      );
      return;
    }
    case 'call': {
      const spec = FORMULA_FUNCTION_BY_ID.get(node.fn);
      if (!spec) {
        issues.push({ code: 'ast_invalid', path, message: `unknown function ${node.fn}` });
        return;
      }
      if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
        issues.push({
          code: 'arity',
          path,
          message: `${node.fn} expects ${spec.minArgs}..${spec.maxArgs} arguments`,
        });
      }
      node.args.forEach((arg, index) =>
        walk(arg, `${path}.args.${index}`, depth + 1, hostKind, issues, counters),
      );
      return;
    }
    case 'aggregate': {
      counters.sources += 1;
      const spec = FORMULA_AGGREGATE_BY_ID.get(node.fn);
      if (!spec) {
        issues.push({ code: 'ast_invalid', path, message: `unknown aggregate ${node.fn}` });
        return;
      }
      if (spec.field === 'required' && node.field === undefined) {
        issues.push({ code: 'aggregate_field', path, message: `${node.fn} requires a field` });
      }
      if (spec.field === 'forbidden' && node.field !== undefined) {
        issues.push({ code: 'aggregate_field', path, message: `${node.fn} does not take a field` });
      }
      if (spec.filter === 'required' && node.filter === undefined) {
        issues.push({
          code: 'aggregate_field',
          path,
          message: `${node.fn} requires a condition`,
        });
      }
      if (node.from.kind === 'related') {
        const selectors = FORMULA_RELATED_MATRIX[hostKind];
        if (!selectors.includes(node.from.selector.kind)) {
          issues.push({
            code: 'selector_forbidden',
            path,
            message: `selector ${node.from.selector.kind} is not available for ${hostKind}`,
          });
        }
      }
      if (node.filter) {
        walk(node.filter, `${path}.filter`, depth + 1, hostKind, issues, counters);
      }
      return;
    }
  }
}

/**
 * Структурная проверка формулы (одна для сервера и редактора): лимиты,
 * матрица источников, арность функций и агрегатов, форма литералов.
 * Типы значений проверяет движок (`inferType`), сохранение — сервер.
 */
export function checkFormulaShape(
  ast: unknown,
  hostKind: FormulaHostKind,
  opts: { typeDefault?: boolean } = {},
): FormulaShapeIssue[] {
  const parsed = formulaNodeSchema.safeParse(ast);
  if (!parsed.success) {
    return [{ code: 'ast_invalid', path: '', message: 'formula AST is invalid' }];
  }
  const issues: FormulaShapeIssue[] = [];
  const counters = { nodes: 0, sources: 0 };
  walk(parsed.data, '', 1, hostKind, issues, counters);
  if (counters.nodes > FORMULA_LIMITS.nodes) {
    issues.push({
      code: 'nodes',
      path: '',
      message: `formula has more than ${FORMULA_LIMITS.nodes} nodes`,
    });
  }
  if (counters.sources > FORMULA_LIMITS.sources) {
    issues.push({
      code: 'sources',
      path: '',
      message: `formula has more than ${FORMULA_LIMITS.sources} sources`,
    });
  }
  if (opts.typeDefault && containsForbiddenTypeSource(parsed.data)) {
    issues.push({
      code: 'type_default_forbidden',
      path: '',
      message: 'related and folder chain sources are not allowed in type formulas',
    });
  }
  return issues;
}

function containsForbiddenTypeSource(node: FormulaNode): boolean {
  switch (node.kind) {
    case 'field':
      return FORMULA_TYPE_FORBIDDEN_SOURCES.includes(node.source.kind);
    case 'op':
    case 'call':
      return node.args.some(containsForbiddenTypeSource);
    case 'aggregate':
      return (
        node.from.kind === 'related' ||
        node.from.kind === 'folder_chain' ||
        (node.filter ? containsForbiddenTypeSource(node.filter) : false)
      );
    default:
      return false;
  }
}

/** Все номера атрибутов, на которые ссылается формула (плашки, уборка,
 *  usage-агрегат «в формулах»). */
export function formulaAttributeNumbers(ast: FormulaNode): number[] {
  const numbers = new Set<number>();
  const visit = (node: FormulaNode): void => {
    switch (node.kind) {
      case 'field':
        numbers.add(node.number);
        if (node.source.kind === 'ref_field') numbers.add(node.source.field);
        return;
      case 'op':
      case 'call':
        node.args.forEach(visit);
        return;
      case 'aggregate':
        if (node.field !== undefined) numbers.add(node.field);
        if (node.filter) visit(node.filter);
        return;
      default:
        return;
    }
  };
  visit(ast);
  return [...numbers].sort((a, b) => a - b);
}
