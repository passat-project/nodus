import type { CustomFieldValues, FormulaNode } from '@nodus/contracts';
import type { FormulaValue } from '@nodus/formula-engine';
import type { FormulaDependency } from '@nodus/formula-engine';

import type { FormulaRecordData } from '../ports/record-values.port.js';
import type { FormulaRegistrySnapshot } from './formula-meta.service.js';

/** Что из окружения нужно формуле (по зависимостям AST). */
export interface NeededSources {
  project: boolean;
  parent: boolean;
  folders: boolean;
  nodeTasks: boolean;
  subtasks: boolean;
  relations: boolean;
  company: boolean;
  refs: boolean;
}

export type RelationSelector = {
  relation: 'relates' | 'blocks' | 'precedes' | 'duplicates';
  direction: 'out' | 'in' | 'both';
};

export function neededSources(deps: readonly FormulaDependency[]): NeededSources {
  const needed: NeededSources = {
    project: false,
    parent: false,
    folders: false,
    nodeTasks: false,
    subtasks: false,
    relations: false,
    company: false,
    refs: false,
  };
  for (const dep of deps) {
    switch (dep.kind) {
      case 'project':
        needed.project = true;
        break;
      case 'parent':
        needed.parent = true;
        break;
      case 'folder':
        needed.folders = true;
        break;
      case 'node_tasks':
        needed.nodeTasks = true;
        break;
      case 'related':
        if (dep.selector === 'subtasks') needed.subtasks = true;
        else if (dep.selector === 'relations') needed.relations = true;
        else needed.nodeTasks = true;
        break;
      case 'company':
        needed.company = true;
        break;
      case 'ref':
        needed.refs = true;
        break;
      default:
        break;
    }
  }
  return needed;
}

/** Узел связи в AST: вид и направление первого агрегата по связям. */
export function findRelationNode(asts: readonly FormulaNode[]): RelationSelector | null {
  for (const ast of asts) {
    const found = searchRelation(ast);
    if (found) return found;
  }
  return null;
}

function searchRelation(node: FormulaNode): RelationSelector | null {
  switch (node.kind) {
    case 'aggregate': {
      if (node.from.kind === 'related' && node.from.selector.kind === 'relations') {
        return {
          relation: node.from.selector.relation,
          direction: node.from.selector.direction,
        };
      }
      return node.filter ? searchRelation(node.filter) : null;
    }
    case 'op':
    case 'call': {
      for (const arg of node.args) {
        const found = searchRelation(arg);
        if (found) return found;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Выборка связей контекста: строки первого узла связей в AST. */
export function relationRows(
  related: ReadonlyMap<string, FormulaRecordData[]>,
  asts: readonly FormulaNode[],
): readonly FormulaRecordData[] {
  const node = findRelationNode(asts);
  if (!node) return [];
  return related.get(`relations:${node.relation}:${node.direction}`) ?? [];
}

/** Глобальные переменные компании (Р7): значения всех isCompany-атрибутов. */
export function companyRecord(snapshot: FormulaRegistrySnapshot): {
  values: CustomFieldValues;
  system: Record<string, FormulaValue | undefined>;
} {
  const values: CustomFieldValues = {};
  for (const row of snapshot.byId.values()) {
    if (!row.isCompany || row.companyValue === null || row.companyValue === undefined) continue;
    values[row.id] = row.companyValue.value as CustomFieldValues[string];
  }
  return { values, system: {} };
}
