import type {
  CustomFieldDefinition,
  FormulaAggregate,
  FormulaHostKind,
  FormulaSource,
  NodeKind,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import type { FormulaHost } from './formula-api.js';

/** Тип «запись по ссылке»: по нему открывается второй шаг — атрибуты цели. */
const REF_FIELD_TYPES = new Set(['project', 'counterparty', 'task', 'letter', 'node']);

/** Дерево источников редактора формул (#632, Р2/Р7): свои поля, родитель,
 *  папки, проект, компания, ссылки, связанные выборки — по матрице носителя. */

export interface SourceLeaf {
  key: string;
  label: string;
  definition: CustomFieldDefinition;
  source: FormulaSource;
}

export interface SourceNode {
  key: string;
  label: string;
  /** Лист: вставка плашки атрибута. */
  leaf?: SourceLeaf;
  /** Ветка: раскрывается списком (вид папки → его атрибуты, ссылка → цель). */
  children?: SourceNode[];
  /** Открыть диалог агрегата с готовой выборкой. */
  aggregate?: FormulaAggregate;
  /** Пункт недоступен (нет родителя/проекта/связанных) — подсказка. */
  disabledHint?: string;
}

export interface SourceGroup {
  key: string;
  label: string;
  items: SourceNode[];
}

function byName(left: CustomFieldDefinition, right: CustomFieldDefinition): number {
  return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ru');
}

function leavesFor(
  definitions: readonly CustomFieldDefinition[],
  sourceOf: (definition: CustomFieldDefinition) => FormulaSource,
  keyPrefix: string,
): SourceNode[] {
  return [...definitions].sort(byName).map((definition) => ({
    key: `${keyPrefix}:${definition.number}`,
    label: definition.name,
    leaf: {
      key: `${keyPrefix}:${definition.number}`,
      label: definition.name,
      definition,
      source: sourceOf(definition),
    },
  }));
}

/** Левая панель редактора: источники по матрице носителя (Р2/Р7). Свои поля —
 *  привязки места; родитель/папки/проект/компания/ссылки — по реестру;
 *  связанные записи открывают диалог агрегата (фильтр и подсчёт — там). */
export function formulaSourceGroups({
  host,
  ownDefinitions,
  allDefinitions,
  kinds,
  hasParent,
  hasProject,
}: {
  host: FormulaHost;
  ownDefinitions: readonly CustomFieldDefinition[];
  allDefinitions: readonly CustomFieldDefinition[];
  kinds: readonly NodeKind[];
  hasParent: boolean;
  hasProject: boolean;
}): SourceGroup[] {
  const hostKind: FormulaHostKind = host.kind;
  const normal = allDefinitions.filter((definition) => !definition.isCompany);
  const company = allDefinitions.filter((definition) => definition.isCompany);
  const projectDefinitions = normal.filter(
    (definition) => definition.bindings.projectTypeIds.length > 0,
  );
  const groups: SourceGroup[] = [];

  groups.push({
    key: 'self',
    label: ui.formulas.sourceGroups.self,
    items: leavesFor(ownDefinitions, () => ({ kind: 'self' }), 'self'),
  });

  if (hostKind === 'task') {
    groups.push({
      key: 'parent',
      label: ui.formulas.sourceGroups.parent,
      items: hasParent
        ? leavesFor(normal, () => ({ kind: 'parent_task' }), 'parent')
        : [
            {
              key: 'parent:none',
              label: ui.formulas.sources.noParent,
              disabledHint: ui.formulas.sources.noParent,
            },
          ],
    });
  }

  if (hostKind === 'task' || hostKind === 'node') {
    const folderItems: SourceNode[] = kinds.map((kind) => ({
      key: `folder:${kind.id}`,
      label: kind.name,
      children: [
        ...leavesFor(
          normal.filter((definition) => definition.bindings.nodeKindIds.includes(kind.id)),
          () => ({ kind: 'folder_nearest', kindId: kind.id }),
          `folder-nearest:${kind.id}`,
        ),
        {
          key: `folder-chain:${kind.id}`,
          label: ui.formulas.sources.folderChain,
          aggregate: {
            kind: 'aggregate',
            from: { kind: 'folder_chain', kindId: kind.id },
            fn: 'count',
          },
        },
      ],
    }));
    groups.push({
      key: 'folders',
      label: ui.formulas.sourceGroups.folders,
      items:
        folderItems.length > 0
          ? folderItems
          : [{ key: 'folders:none', label: ui.formulas.sources.noFolder }],
    });
  }

  if (hostKind === 'task' || hostKind === 'node') {
    groups.push({
      key: 'project',
      label: ui.formulas.sourceGroups.project,
      items: hasProject
        ? leavesFor(projectDefinitions, () => ({ kind: 'project' }), 'project')
        : [
            {
              key: 'project:none',
              label: ui.formulas.sources.noProject,
              disabledHint: ui.formulas.sources.noProject,
            },
          ],
    });
  }

  groups.push({
    key: 'company',
    label: ui.formulas.sourceGroups.company,
    items: leavesFor(company, () => ({ kind: 'company' }), 'company'),
  });

  const refFields = ownDefinitions.filter((definition) => REF_FIELD_TYPES.has(definition.type));
  groups.push({
    key: 'ref',
    label: ui.formulas.sourceGroups.ref,
    items:
      refFields.length > 0
        ? refFields.map((definition) => ({
            key: `ref:${definition.number}`,
            label: definition.name,
            children: leavesFor(
              normal.filter((entry) => entry.number !== definition.number),
              () => ({ kind: 'ref_field', field: definition.number }),
              `ref-${definition.number}`,
            ),
          }))
        : [{ key: 'ref:none', label: ui.formulas.sources.noRefField }],
  });

  if (hostKind === 'task') {
    groups.push({
      key: 'related',
      label: ui.formulas.sourceGroups.related,
      items: [
        {
          key: 'related:subtasks',
          label: ui.formulas.sources.subtasks,
          aggregate: {
            kind: 'aggregate',
            from: { kind: 'related', selector: { kind: 'subtasks' } },
            fn: 'count',
          },
        },
        {
          key: 'related:node-tasks',
          label: ui.formulas.sources.nodeTasks,
          aggregate: {
            kind: 'aggregate',
            from: { kind: 'related', selector: { kind: 'node_tasks' } },
            fn: 'count',
          },
        },
        {
          key: 'related:relations',
          label: ui.formulas.sources.relations,
          aggregate: {
            kind: 'aggregate',
            from: {
              kind: 'related',
              selector: { kind: 'relations', relation: 'relates', direction: 'both' },
            },
            fn: 'count',
          },
        },
      ],
    });
  }

  if (hostKind === 'node') {
    groups.push({
      key: 'related',
      label: ui.formulas.sourceGroups.related,
      items: [
        {
          key: 'related:node-tasks',
          label: ui.formulas.sources.nodeTasks,
          aggregate: {
            kind: 'aggregate',
            from: { kind: 'related', selector: { kind: 'node_tasks' } },
            fn: 'count',
          },
        },
      ],
    });
  }

  return groups.filter((group) => group.items.length > 0);
}
