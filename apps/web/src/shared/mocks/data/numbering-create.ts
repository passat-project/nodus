import type { NumberPlace, NumberSeriesRule } from '@nodus/contracts';
import { resolveNumberContainer } from '@nodus/contracts';

import { demoCustomFieldDefinitions } from './custom-fields.js';
import { issueMockNumber } from './numbering-store.js';
import { findDemoNodeRow } from './project-nodes.js';
import { demoProjectRows } from './projects.js';

/** Выдача номеров «При создании записи» в мок-мире (#630): место новой
 *  записи (папки снаружи, проект, портфель, тип) и выдача всех счётчиков с
 *  флагом, привязанных к её типу. Зеркало серверного пути создания. */

/** Цепочка папок СНАРУЖИ записи от ближайшей вверх (мок-мир). */
function foldersFrom(nodeId: string | null): { id: string; kindId: string }[] {
  const folders: { id: string; kindId: string }[] = [];
  let current = nodeId ? findDemoNodeRow(nodeId) : undefined;
  while (current) {
    folders.push({ id: current.id, kindId: current.kindId });
    current = current.parentId ? findDemoNodeRow(current.parentId) : undefined;
  }
  return folders;
}

function projectPlace(projectId: string | null) {
  const project = demoProjectRows.find((row) => row.id === projectId);
  return {
    projectId: project?.id ?? null,
    portfolioId: project?.portfolioId ?? null,
    projectTypeId: project?.typeId ?? null,
  };
}

const valueReader =
  (values: Record<string, unknown>) =>
  (number: number): string | null => {
    const definition = demoCustomFieldDefinitions.find((entry) => entry.number === number);
    const value = definition ? values[definition.id] : undefined;
    return typeof value === 'string' && value ? value : null;
  };

/** Место создаваемой папки: родитель и выше, проект папки. */
export function placeOfNewNode(
  projectId: string,
  parentId: string | null,
  values: Record<string, unknown>,
): NumberPlace {
  return {
    host: 'node',
    folders: foldersFrom(parentId),
    ...projectPlace(projectId),
    parentTaskId: null,
    fieldValue: valueReader(values),
  };
}

/** Место создаваемого проекта: сам себе не контейнер — тип и портфель. */
export function placeOfNewProject(
  typeId: string,
  portfolioId: string | null,
  values: Record<string, unknown>,
): NumberPlace {
  return {
    host: 'project',
    folders: [],
    projectId: null,
    portfolioId,
    projectTypeId: typeId,
    parentTaskId: null,
    fieldValue: valueReader(values),
  };
}

/** Место создаваемой задачи (до попадания в список). */
export function placeOfNewTask(input: {
  nodeId: string | null;
  projectId: string | null;
  parentId: string | null;
  values: Record<string, unknown>;
}): NumberPlace {
  return {
    host: 'task',
    folders: foldersFrom(input.nodeId),
    ...projectPlace(input.projectId),
    parentTaskId: input.parentId,
    fieldValue: valueReader(input.values),
  };
}

export type CreateNumbering =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; fieldId: string; fieldName: string; reason: string };

/**
 * Выдача «При создании записи» (#630): все счётчики с флагом, привязанные к
 * типу создаваемой записи. Контейнеры находятся ДО выдачи: нет хотя бы
 * одного — создание отклоняется (409 NUMBER_CONTAINER_MISSING), ничего не
 * тратится — как транзакция создания на сервере. Уже заполненное поле
 * (пришло телом) не трогается.
 */
export function issueOnCreate(
  place: NumberPlace,
  typeId: string,
  values: Record<string, unknown>,
): CreateNumbering {
  const bound = demoCustomFieldDefinitions.filter((definition) => {
    const rule = definition.numbering?.rule;
    if (definition.type !== 'counter' || !rule?.issueOnCreate) return false;
    const { bindings } = definition;
    if (place.host === 'node') return bindings.nodeKindIds.includes(typeId);
    if (place.host === 'project') return bindings.projectTypeIds.includes(typeId);
    return bindings.processTypeIds.includes(typeId);
  });
  const pending: { fieldId: string; rule: NumberSeriesRule; containerId: string | null }[] = [];
  for (const definition of bound) {
    const rule = definition.numbering!.rule;
    if (values[definition.id] !== undefined && values[definition.id] !== null) continue;
    const resolved = resolveNumberContainer(rule.container, place);
    if (!resolved.ok) {
      return {
        ok: false,
        fieldId: definition.id,
        fieldName: definition.name,
        reason: resolved.reason,
      };
    }
    pending.push({ fieldId: definition.id, rule, containerId: resolved.containerId });
  }
  const next = { ...values };
  for (const { fieldId, rule, containerId } of pending) {
    next[fieldId] = issueMockNumber(fieldId, rule, containerId);
  }
  return { ok: true, values: next };
}
