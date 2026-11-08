import type {
  CustomFieldBindings,
  NumberContainerHit,
  NumberContainerMissingReason,
  NumberHostKind,
  NumberHostSample,
  NumberSeriesRule,
} from '@nodus/contracts';
import {
  numberContainerReachable,
  numberCreateTriggerProblem,
  numberEmptySegments,
  resolveNumberContainers,
} from '@nodus/contracts';

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { placeOfTask, segmentReaderOfTask } from '../../mocks/data/numbering-store.js';
import { mockTypes } from '../../mocks/data/process-types-store.js';
import {
  placeOfNewNode,
  placeOfNewProject,
  type NewRecordPlace,
} from '../../mocks/data/numbering-create.js';
import { demoNodeRows, findDemoNodeRow } from '../../mocks/data/project-nodes.js';
import { canSeeProject } from '../../mocks/data/project-views.js';
import { demoProjectRows } from '../../mocks/data/projects.js';
import { demoTasks } from '../../mocks/data/tasks.js';
import { getMockActor } from '../../mocks/mock-actor.js';

/** Записи мок-мира для счётчиков (#630, модель v3): кто может получать
 *  номер, где лежит, видит ли его администратор; совместимость привязок и
 *  «при создании»; план выдачи существующим. Вынесено из
 *  `numbering-handlers.ts` (I5): там — только HTTP. */

/** Вид записи цели привязки (мок-мир): тип процесса → task/letter. */
function hostOfType(typeId: string): NumberHostKind | null {
  const type = mockTypes.find((entry) => entry.id === typeId);
  return type ? (type.category === 'letter' ? 'letter' : 'task') : null;
}

/** Привязки, чьи записи не лежат в условиях правила (422 у сервера). */
export function unreachableTargets(
  rule: NumberSeriesRule,
  bindings: CustomFieldBindings,
): string[] {
  const reachable = (host: NumberHostKind) =>
    rule.containers.every((container) => numberContainerReachable(container, host));
  const out: string[] = [];
  for (const id of bindings.processTypeIds) {
    const host = hostOfType(id);
    if (host && !reachable(host)) out.push(id);
  }
  if (!reachable('project')) out.push(...bindings.projectTypeIds);
  if (!reachable('node')) out.push(...bindings.nodeKindIds);
  return out;
}

/** «При создании» не у привязанного типа или невозможно письму (422). */
export function invalidTriggers(
  rule: NumberSeriesRule,
  onCreate: readonly string[],
  bindings: CustomFieldBindings,
): string[] {
  const bound = new Set([
    ...bindings.processTypeIds,
    ...bindings.projectTypeIds,
    ...bindings.nodeKindIds,
  ]);
  return onCreate.filter((id) => {
    if (!bound.has(id)) return true;
    const host = hostOfType(id);
    return host === 'letter' && numberCreateTriggerProblem(rule, host) !== null;
  });
}

/** Существующая запись мок-мира, которая может получать номер. */
export interface MockHost {
  kind: NumberHostKind;
  id: string;
  name: string;
  typeId: string;
  /** Порядок создания: у задачи — её номер (в списке нет даты создания),
   *  у папки и проекта — дата создания. */
  order: number;
  visible: boolean;
  target: NewRecordPlace;
  values: () => Record<string, unknown>;
  write: (fieldId: string, display: string) => void;
}

export function hostsOf(typeIds: readonly string[]): MockHost[] {
  const ids = new Set(typeIds);
  const actor = getMockActor();
  const visibleProject = (projectId: string | null | undefined) => {
    const project = demoProjectRows.find((row) => row.id === projectId);
    return !project || canSeeProject(project, actor);
  };
  return [
    ...demoTasks
      .filter((task) => ids.has(task.type.id))
      .map((task): MockHost => ({
        kind: 'task',
        id: task.id,
        name: task.title,
        typeId: task.type.id,
        order: task.number,
        visible: visibleProject(task.project?.id),
        target: { place: placeOfTask(task), field: segmentReaderOfTask(task) },
        values: () => task.customFields,
        // customFields демо-задачи — ленивый геттер стора значений:
        // присваивание целиком, мутация вложенного объекта терялась бы.
        write: (fieldId, display) => {
          task.customFields = { ...task.customFields, [fieldId]: display };
        },
      })),
    ...demoNodeRows
      .filter((node) => ids.has(node.kindId))
      .map((node): MockHost => ({
        kind: 'node',
        id: node.id,
        name: node.name,
        typeId: node.kindId,
        order: Date.parse(node.createdAt),
        visible: visibleProject(node.projectId),
        target: placeOfNewNode(node.projectId, node.parentId, node.kindId, node.customFields ?? {}),
        values: () => node.customFields ?? {},
        write: (fieldId, display) => {
          node.customFields = { ...(node.customFields ?? {}), [fieldId]: display };
        },
      })),
    ...demoProjectRows
      .filter((project) => ids.has(project.typeId))
      .map((project): MockHost => ({
        kind: 'project',
        id: project.id,
        name: project.name,
        typeId: project.typeId,
        order: Date.parse(project.createdAt),
        visible: canSeeProject(project, actor),
        target: placeOfNewProject(
          project.typeId,
          project.portfolioId ?? null,
          project.customFields,
        ),
        values: () => project.customFields,
        write: (fieldId, display) => {
          project.customFields = { ...project.customFields, [fieldId]: display };
        },
      })),
  ];
}

export const sampleOf = (
  host: MockHost,
  reason: NumberContainerMissingReason,
): NumberHostSample => ({
  kind: host.kind,
  id: host.id,
  name: host.name,
  reason,
});

/** Типы-получатели атрибута (все привязки). */
export function participantsOf(bindings: CustomFieldBindings): string[] {
  return [...bindings.processTypeIds, ...bindings.projectTypeIds, ...bindings.nodeKindIds];
}

/** Значения условий из тела «следующего номера»: вид записи по условию. */
export function hitsOfIds(
  rule: NumberSeriesRule,
  ids: readonly string[],
): NumberContainerHit[] | null {
  if (ids.length !== rule.containers.length) return null;
  return rule.containers.map((container, index): NumberContainerHit => {
    const id = ids[index]!;
    switch (container.kind) {
      case 'folder':
        return { entity: 'node', id };
      case 'parent_folder':
        return findDemoNodeRow(id) ? { entity: 'node', id } : { entity: 'project', id };
      case 'project':
        return { entity: 'project', id };
      case 'project_type':
        return { entity: 'project_type', id };
      case 'portfolio':
        return { entity: 'portfolio', id };
      case 'parent_task':
        return { entity: 'task', id };
      case 'field':
        return { entity: 'value', id };
      case 'record_type':
        return { entity: 'type', id };
    }
  });
}

export interface BackfillPlanItem {
  host: MockHost;
  hits: NumberContainerHit[];
  empty: boolean;
}

/** План выдачи существующим: записи без номера по порядку создания. */
export function backfillPlan(
  fieldId: string,
  rule: NumberSeriesRule,
  bindings: CustomFieldBindings,
) {
  const items: BackfillPlanItem[] = [];
  const blocked: { host: MockHost; reason: NumberContainerMissingReason }[] = [];
  const candidates = hostsOf(participantsOf(bindings))
    .filter((host) => {
      const value = host.values()[fieldId];
      return value === undefined || value === null || value === '';
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const host of candidates) {
    const resolved = resolveNumberContainers(rule.containers, host.target.place);
    if (!resolved.ok) {
      blocked.push({ host, reason: resolved.reason });
      continue;
    }
    const empty = numberEmptySegments(rule.template, host.target.field).length > 0;
    items.push({ host, hits: resolved.hits, empty });
  }
  return { items, blocked };
}

/** Сколько записей отмеченных типов ещё без номера (DTO `withoutNumber`). */
export function mockWithoutNumber(fieldId: string): number {
  const definition = demoCustomFieldDefinitions.find((entry) => entry.id === fieldId);
  const rule = definition?.numbering?.rule;
  if (!definition || !rule) return 0;
  return backfillPlan(fieldId, rule, definition.bindings).items.length;
}
