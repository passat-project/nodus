import type {
  CustomFieldDefinition,
  CustomFieldValue,
  CustomFieldValues,
  FormulaHostKind,
  MoneyValue,
} from '@nodus/contracts';
import type { FormulaRecord, FormulaResolver, FormulaValue } from '@nodus/formula-engine';

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { itemById } from '../../mocks/data/dictionaries.js';
import { findLetter } from '../../mocks/data/letters.js';
import { findDemoNodeRow } from '../../mocks/data/project-nodes.js';
import { findDemoProjectRow } from '../../mocks/data/projects.js';
import { canSeeProject, projectCustomFieldsOf } from '../../mocks/data/project-views.js';
import { demoSubtasks, demoTasks } from '../../mocks/data/tasks.js';
import { currentAuthUser } from '../../mocks/data/users.js';

import {
  fieldByNumber,
  findDemoTask,
  findFormulaHost,
  type DemoFormulaHost,
} from './formula-state.js';

/** Демо-резолвер формул (#632, Р7): единственная точка чтения данных
 *  формулой. Источники одного значения и выборки агрегатов собираются из
 *  мок-мира; невидимые записи (конфиденциальные задачи, чужие секретные
 *  проекты) резолвер не отдаёт — движок не умеет читать мимо него. */

/** Значение атрибута в языке формул: перечисления — КОД варианта
 *  (короткая марка «КЖ»; без кода — подпись), списки — массив кодов,
 *  ссылки — id. */
export function toFormulaValue(
  definition: CustomFieldDefinition,
  value: CustomFieldValue,
): FormulaValue {
  switch (definition.type) {
    case 'enum': {
      const item = itemById(String(value));
      return item ? (item.code ?? item.name) : String(value);
    }
    case 'multienum':
    case 'users': {
      const ids = Array.isArray(value) ? value : [String(value)];
      return ids.map((id) => {
        const item = itemById(id);
        return item ? (item.code ?? item.name) : id;
      });
    }
    case 'money':
      return value as MoneyValue;
    case 'bool':
      return Boolean(value);
    case 'number':
    case 'duration':
      return typeof value === 'number' ? value : Number(value);
    default:
      return String(value);
  }
}

function valuesRecord(values: CustomFieldValues): FormulaRecord {
  return {
    value: (number) => {
      const definition = fieldByNumber(number);
      if (!definition) return undefined;
      const raw = values[definition.id];
      if (raw === undefined || raw === null) return undefined;
      return toFormulaValue(definition, raw);
    },
  };
}

function taskRecord(task: { customFields?: CustomFieldValues }): FormulaRecord {
  return valuesRecord(task.customFields ?? {});
}

/** Задача видна формуле: без признака конфиденциальности и в видимом
 *  проекте (Р7: резолвер обязан отфильтровать выборку). */
function isTaskVisible(task: { confidential?: boolean; project?: { id: string } | null }): boolean {
  if (task.confidential === true) return false;
  const projectId = task.project?.id;
  if (!projectId) return true;
  const row = findDemoProjectRow(projectId);
  return row ? canSeeProject(row, currentAuthUser) : false;
}

function projectRecord(projectId: string | null): FormulaRecord | null {
  if (!projectId) return null;
  const row = findDemoProjectRow(projectId);
  if (!row || !canSeeProject(row, currentAuthUser)) return null;
  return valuesRecord(projectCustomFieldsOf(row));
}

/** Глобальные переменные компании (Р7) — одним срезом значений. */
function companyRecord(): FormulaRecord {
  const values: CustomFieldValues = {};
  for (const definition of demoCustomFieldDefinitions) {
    if (!definition.isCompany) continue;
    if (definition.companyValue === null || definition.companyValue === undefined) continue;
    values[definition.id] = definition.companyValue;
  }
  return valuesRecord(values);
}

/** Ближайшая папка нужного вида: от узла записи вверх по родителям;
 *  папка-хост участвует сама (Р2). */
function nearestFolderRecord(host: DemoFormulaHost, kindId: string): FormulaRecord | null {
  let currentId: string | null = host.nodeId;
  while (currentId) {
    const row = findDemoNodeRow(currentId);
    if (!row) return null;
    if (row.kindId === kindId) return valuesRecord(row.customFields);
    currentId = row.parentId;
  }
  return null;
}

/** Цепочка папок-предков нужного вида от корня к ближайшей (агрегаты). */
function folderChainRecords(host: DemoFormulaHost, kindId: string): FormulaRecord[] {
  // Папка-хост в цепочку не входит: цепочка — предки (сама запись — `self`).
  let currentId: string | null =
    host.kind === 'node' ? (findDemoNodeRow(host.id)?.parentId ?? null) : host.nodeId;
  const chain: FormulaRecord[] = [];
  while (currentId) {
    const row = findDemoNodeRow(currentId);
    if (!row) break;
    if (row.kindId === kindId) chain.push(valuesRecord(row.customFields));
    currentId = row.parentId;
  }
  return chain.reverse();
}

/** Дети задачи: общий список + свежесозданные подзадачи, без дублей. */
function childTasksOf(parentId: string) {
  const seen = new Set<string>();
  return [
    ...demoTasks.filter((task) => task.parentId === parentId),
    ...(demoSubtasks[parentId] ?? []),
  ]
    .filter((task) => (seen.has(task.id) ? false : (seen.add(task.id), true)))
    .filter(isTaskVisible);
}

/** Запись, на которую указывает атрибут-ссылка (`ref_field`, Р2). */
function refFieldRecord(host: DemoFormulaHost, number: number): FormulaRecord | null {
  const reference = fieldByNumber(number);
  if (!reference) return null;
  const raw = host.customFields[reference.id];
  if (raw === undefined || raw === null || Array.isArray(raw)) return null;
  const targetId = String(raw);
  switch (reference.type) {
    case 'task': {
      const task = findDemoTask(targetId);
      return task && isTaskVisible(task) ? taskRecord(task) : null;
    }
    case 'letter': {
      const letter = findLetter(targetId);
      return letter ? valuesRecord(letter.customFields) : null;
    }
    case 'project':
      return projectRecord(targetId);
    case 'node': {
      const row = findDemoNodeRow(targetId);
      return row ? valuesRecord(row.customFields) : null;
    }
    default:
      return null;
  }
}

/** Демо-резолвер хоста: null — записи нет (эндпоинт отвечает 404). */
export function demoResolver(kind: FormulaHostKind, hostId: string): FormulaResolver | null {
  const host = findFormulaHost(kind, hostId);
  if (!host) return null;
  return {
    single(source) {
      switch (source.kind) {
        case 'self':
          return valuesRecord(host.customFields);
        case 'parent_task': {
          if (kind !== 'task' || !host.parentId) return null;
          const parent = findDemoTask(host.parentId);
          return parent && isTaskVisible(parent) ? taskRecord(parent) : null;
        }
        case 'folder_nearest':
          return nearestFolderRecord(host, source.kindId);
        case 'project':
          return projectRecord(host.kind === 'project' ? host.id : host.projectId);
        case 'company':
          return companyRecord();
        case 'ref_field':
          return refFieldRecord(host, source.field);
        default:
          return null;
      }
    },
    select(from) {
      if (from.kind === 'folder_chain') return folderChainRecords(host, from.kindId);
      switch (from.selector.kind) {
        case 'subtasks':
          return kind === 'task' ? childTasksOf(host.id).map(taskRecord) : [];
        case 'node_tasks': {
          const nodeId = host.nodeId;
          if (!nodeId) return [];
          return demoTasks
            .filter((task) => task.nodeId === nodeId)
            .filter(isTaskVisible)
            .map(taskRecord);
        }
        default:
          // Связей задач в демо-мире нет (#39): честная пустая выборка.
          return [];
      }
    },
  };
}
