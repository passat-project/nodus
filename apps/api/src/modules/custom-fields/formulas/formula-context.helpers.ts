import type { CustomFieldValues } from '@nodus/contracts';
import type { FormulaValue } from '@nodus/formula-engine';
import type { FormulaDependency } from '@nodus/formula-engine';

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

export { resolveRefSource } from './formula-ref.js';

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
      case 'system':
        // Системное поле может стоять на любом источнике (родитель, папка,
        // проект, ссылка): грузим все — дешевле, чем неверный null.
        needed.parent = true;
        needed.project = true;
        needed.folders = true;
        needed.refs = true;
        break;
      default:
        break;
    }
  }
  return needed;
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
