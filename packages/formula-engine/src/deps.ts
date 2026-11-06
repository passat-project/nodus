import type { FormulaNode, FormulaSource } from '@nodus/contracts';

import type { FormulaDependency } from './types.js';

function sourceDep(source: FormulaSource, number: number): FormulaDependency | null {
  switch (source.kind) {
    case 'self':
      return { kind: 'value', number };
    case 'parent_task':
      return { kind: 'parent', number };
    case 'project':
      return { kind: 'project', number };
    case 'company':
      return { kind: 'company', number };
    case 'ref_field':
      return { kind: 'ref', refField: source.field, number };
    case 'folder_nearest':
      return { kind: 'folder', kindId: source.kindId, number };
    case 'folder_chain':
    case 'related':
      // Многозначные источники допустимы только в агрегате (checkFormulaShape).
      return null;
  }
}

/**
 * Зависимости формулы (Р4): что должно измениться, чтобы ячейку пересчитали.
 * Чистые дескрипторы без id записей — API превращает их в ключи
 * `formula_deps.dep_key` в контексте конкретного хоста (там же, где известны
 * проект/родитель/цель ссылки). Дедупликация по смыслу.
 */
export function extractDeps(ast: FormulaNode): FormulaDependency[] {
  const deps: FormulaDependency[] = [];
  const seen = new Set<string>();
  const add = (dep: FormulaDependency | null): void => {
    if (!dep) return;
    const key = JSON.stringify(dep);
    if (seen.has(key)) return;
    seen.add(key);
    deps.push(dep);
  };
  const visit = (node: FormulaNode): void => {
    switch (node.kind) {
      case 'literal':
        return;
      case 'field':
        add(sourceDep(node.source, node.number));
        return;
      case 'op':
      case 'call':
        node.args.forEach(visit);
        return;
      case 'aggregate': {
        if (node.from.kind === 'folder_chain') {
          add({
            kind: 'folder',
            kindId: node.from.kindId,
            ...(node.field ? { number: node.field } : {}),
          });
        } else {
          const selector = node.from.selector.kind;
          add({
            kind: selector === 'node_tasks' ? 'node_tasks' : 'related',
            selector,
            ...(node.field ? { number: node.field } : {}),
          });
        }
        if (node.filter) visit(node.filter);
        return;
      }
    }
  };
  visit(ast);
  return deps;
}
