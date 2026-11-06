import {
  formulaNodeSchema,
  type FormulaNode,
  type FormulaOperator,
  type FormulaSource,
} from './formula.js';
import type { FormulaShapeIssue } from './formula-validation.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Человекочитаемая запись формулы и её разбор на границе HTTP/моков (#632):
 * стабильная строка для текстов/тестов и `parseFormula` с причиной отказа.
 */

/** Человекочитаемая запись формулы для превью/журнала (редактор строит
 *  плашки сам; здесь — стабильная строка для текстов и тестов). */
export function formulaToText(
  ast: FormulaNode,
  labelOf: (number: number, fallback?: string) => string,
): string {
  const sourcePrefix = (source: FormulaSource): string => {
    switch (source.kind) {
      case 'self':
        return '';
      case 'parent_task':
        return 'Родитель · ';
      case 'folder_nearest':
        return 'Папка · ';
      case 'folder_chain':
        return 'Цепочка папок · ';
      case 'project':
        return 'Проект · ';
      case 'company':
        return 'Компания · ';
      case 'ref_field':
        return 'По ссылке · ';
      case 'related':
        return 'Связанные · ';
    }
  };
  const render = (node: FormulaNode): string => {
    switch (node.kind) {
      case 'literal':
        return typeof node.value === 'string' ? `"${node.value}"` : String(node.value);
      case 'field':
        return `${sourcePrefix(node.source)}{${labelOf(node.number, node.name)}}`;
      case 'op': {
        const symbol: Record<FormulaOperator, string> = {
          add: '+',
          sub: '-',
          mul: '*',
          div: '/',
          concat: '&',
          eq: '=',
          ne: '≠',
          lt: '<',
          le: '≤',
          gt: '>',
          ge: '≥',
        };
        return node.args.map(render).join(` ${symbol[node.op]} `);
      }
      case 'call':
        return `${node.fn}(${node.args.map(render).join('; ')})`;
      case 'aggregate':
        return `${node.fn}(${node.from.kind === 'folder_chain' ? 'цепочка папок' : node.from.selector.kind}${node.field !== undefined ? `; {${labelOf(node.field)}}` : ''})`;
    }
  };
  return render(ast);
}

/** Разбор `unknown` в AST с ошибкой-причиной (граница HTTP/моков). */
export function parseFormula(ast: unknown): {
  ast: FormulaNode | null;
  issues: FormulaShapeIssue[];
} {
  if (ast === null || ast === undefined) return { ast: null, issues: [] };
  const parsed = formulaNodeSchema.safeParse(ast);
  if (!parsed.success) {
    return {
      ast: null,
      issues: [{ code: 'ast_invalid', path: '', message: 'formula AST is invalid' }],
    };
  }
  return { ast: parsed.data, issues: [] };
}

/** Защита от ручного JSON мимо схемы: объект узла, а не массив. */
export function isFormulaNode(value: unknown): value is FormulaNode {
  return (
    isRecord(value) && typeof value.kind === 'string' && formulaNodeSchema.safeParse(value).success
  );
}
