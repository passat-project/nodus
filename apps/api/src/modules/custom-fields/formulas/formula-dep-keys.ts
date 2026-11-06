import type { FormulaHostKind, FormulaNode } from '@nodus/contracts';
import type { FormulaDependency } from '@nodus/formula-engine';

import type { FormulaRecordData } from '../ports/record-values.port.js';
import type { FormulaRegistrySnapshot } from './formula-meta.service.js';

/** Ключ зависимости ячейки (#632, Р4) в контексте конкретного хоста. */
export interface FormulaDepKey {
  key: string;
  /** Номер атрибута зависимости — поиск «кто ссылается на N» (Р13). */
  attrNumber: number | null;
}

export interface FormulaDepArgs {
  host: FormulaRecordData;
  hostKind: FormulaHostKind;
  project: FormulaRecordData | null;
  nodes: ReadonlyMap<string, FormulaRecordData>;
  parent: FormulaRecordData | null;
  related: ReadonlyMap<string, FormulaRecordData[]>;
  asts: readonly FormulaNode[];
  deps: readonly FormulaDependency[];
  snapshot: FormulaRegistrySnapshot;
}

/**
 * Зависимости формулы в контексте хоста (#632, Р4): что должно измениться,
 * чтобы ячейку пересчитали. Форматы ключей — `v:<kind>:<uuid>:<number>`,
 * `company:<number>`, `tree:project:<uuid>`, `rel:task:<uuid>`,
 * `subtasks:task:<uuid>`, `nodetasks:node:<uuid>`, `parent:task:<uuid>`.
 */
export function buildDepKeys(args: FormulaDepArgs): FormulaDepKey[] {
  const keys = new Map<string, number | null>();
  const add = (key: string, attrNumber: number | null = null): void => {
    if (!keys.has(key)) keys.set(key, attrNumber);
  };
  const hostProject = args.hostKind === 'project' ? args.host.id : args.host.projectId;
  for (const dep of args.deps) {
    switch (dep.kind) {
      case 'value':
        if (dep.number !== undefined) {
          add(`v:${args.hostKind}:${args.host.id}:${dep.number}`, dep.number);
        }
        break;
      case 'company':
        if (dep.number !== undefined) add(`company:${dep.number}`, dep.number);
        break;
      case 'parent':
        if (args.parent) {
          add(`v:task:${args.parent.id}:${dep.number ?? 0}`, dep.number ?? null);
          // Смена родителя меняет источник целиком (Р7 в).
          add(`parent:task:${args.host.id}`);
        }
        break;
      case 'project':
        if (args.project) {
          add(`v:project:${args.project.id}:${dep.number ?? 0}`, dep.number ?? null);
        }
        break;
      case 'ref': {
        if (dep.refField === undefined) break;
        const definition = args.snapshot.byNumber.get(dep.refField);
        const raw = definition ? args.host.values[definition.id] : undefined;
        if (definition && raw !== undefined && raw !== null && !Array.isArray(raw)) {
          add(`v:${definition.type}:${String(raw)}:${dep.number ?? 0}`, dep.number ?? null);
        }
        break;
      }
      case 'folder': {
        // Срез проекта меняется переносом/созданием/удалением папки — ключ
        // дерева; значения предков — поключево.
        if (hostProject) add(`tree:project:${hostProject}`);
        let currentId: string | null = args.hostKind === 'node' ? args.host.id : args.host.nodeId;
        const guard = new Set<string>();
        while (currentId && !guard.has(currentId)) {
          guard.add(currentId);
          const node = args.nodes.get(currentId);
          if (!node) break;
          add(`v:node:${node.id}:${dep.number ?? 0}`, dep.number ?? null);
          currentId = node.parentId;
        }
        break;
      }
      case 'related': {
        if (dep.selector === 'node_tasks') {
          const nodeId = args.hostKind === 'node' ? args.host.id : args.host.nodeId;
          if (nodeId) add(`nodetasks:node:${nodeId}`);
        } else if (dep.selector === 'subtasks') {
          add(`subtasks:task:${args.host.id}`);
          for (const row of args.related.get('subtasks') ?? []) {
            add(`v:task:${row.id}:${dep.number ?? 0}`, dep.number ?? null);
          }
        } else {
          add(`rel:task:${args.host.id}`);
          for (const [key, rows] of args.related) {
            if (!key.startsWith('relations:')) continue;
            for (const row of rows) add(`v:task:${row.id}:${dep.number ?? 0}`, dep.number ?? null);
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return [...keys].map(([key, attrNumber]) => ({ key, attrNumber }));
}
