import type { CustomFieldValues, FormulaHostKind } from '@nodus/contracts';
import type { FormulaRecord, FormulaResolver, FormulaValue } from '@nodus/formula-engine';

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { findLetter } from '../../mocks/data/letters.js';
import { demoNodeKinds, findDemoNodeRow } from '../../mocks/data/project-nodes.js';
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
import { toFormulaValue } from './formula-value-map.js';

/** Демо-резолвер формул (#632, Р7): единственная точка чтения данных
 *  формулой. Источники одного значения и выборки агрегатов собираются из
 *  мок-мира; невидимые записи (конфиденциальные задачи, чужие секретные
 *  проекты) резолвер не отдаёт — движок не умеет читать мимо него. */

function valuesRecord(
  values: CustomFieldValues,
  system?: (key: string) => FormulaValue | undefined,
): FormulaRecord {
  return {
    value: (number) => {
      const definition = fieldByNumber(number);
      if (!definition) return undefined;
      const raw = values[definition.id];
      if (raw === undefined || raw === null) return undefined;
      return toFormulaValue(definition, raw);
    },
    ...(system ? { system } : {}),
  };
}

function systemReader(
  entries: Record<string, FormulaValue | undefined>,
): (key: string) => FormulaValue | undefined {
  return (key) => entries[key];
}

function taskSystem(task: {
  title?: string;
  number?: number;
  deadline?: string | null;
  createdAt?: string;
  stage?: { name?: string };
  assignee?: { id: string } | null;
  creator?: { id: string } | null;
}): (key: string) => FormulaValue | undefined {
  return systemReader({
    title: task.title,
    number: task.number,
    deadline: task.deadline ?? null,
    createdAt: task.createdAt,
    stage: task.stage?.name,
    assignee: task.assignee?.id ?? null,
    creator: task.creator?.id ?? null,
  });
}

function letterSystem(letter: {
  subject?: string | null;
  regNumber?: string | null;
  regDate?: string | null;
  receivedAt?: string;
  correspondent?: { id: string } | null;
  theirNumber?: string | null;
  theirDate?: string | null;
}): (key: string) => FormulaValue | undefined {
  return systemReader({
    subject: letter.subject ?? null,
    regNumber: letter.regNumber ?? null,
    regDate: letter.regDate ?? null,
    receivedAt: letter.receivedAt,
    correspondent: letter.correspondent?.id ?? null,
    theirNumber: letter.theirNumber ?? null,
    theirDate: letter.theirDate ?? null,
  });
}

function projectSystem(row: {
  name?: string;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  managerId?: string;
}): (key: string) => FormulaValue | undefined {
  return systemReader({
    name: row.name,
    status: row.status,
    startDate: row.startDate ?? null,
    endDate: row.endDate ?? null,
    manager: row.managerId ?? null,
  });
}

function nodeSystem(row: {
  name?: string;
  kindId?: string;
  createdAt?: string;
}): (key: string) => FormulaValue | undefined {
  const kind = demoNodeKinds.find((entry) => entry.id === row.kindId);
  return systemReader({
    name: row.name,
    kind: kind?.name,
    createdAt: row.createdAt,
  });
}

function taskRecord(
  task: { customFields?: CustomFieldValues } & Parameters<typeof taskSystem>[0],
): FormulaRecord {
  return valuesRecord(task.customFields ?? {}, taskSystem(task));
}

/** Задача видна формуле: без признака конфиденциальности и в видимом
 *  проекте (Р7: резолвер обязан отфильтровать выборку). Экспорт — резолвер
 *  создания (`formula-creation-resolver.ts`). */
export function isTaskVisible(task: {
  confidential?: boolean;
  project?: { id: string } | null;
}): boolean {
  if (task.confidential === true) return false;
  const projectId = task.project?.id;
  if (!projectId) return true;
  const row = findDemoProjectRow(projectId);
  return row ? canSeeProject(row, currentAuthUser) : false;
}

/** Запись проекта, видимая текущему пользователю (иначе null).
 *  Экспорт — резолвер создания (`formula-creation-resolver.ts`). */
export function projectRecord(projectId: string | null): FormulaRecord | null {
  if (!projectId) return null;
  const row = findDemoProjectRow(projectId);
  if (!row || !canSeeProject(row, currentAuthUser)) return null;
  return valuesRecord(projectCustomFieldsOf(row), projectSystem(row));
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
    if (row.kindId === kindId) return valuesRecord(row.customFields, nodeSystem(row));
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
    if (row.kindId === kindId) chain.push(valuesRecord(row.customFields, nodeSystem(row)));
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
      // Конфиденциальные письма исключены ДЛЯ ВСЕХ (вердикт В1 06.11).
      if (!letter || letter.confidential) return null;
      return valuesRecord(letter.customFields, letterSystem(letter));
    }
    case 'project':
      return projectRecord(targetId);
    case 'node': {
      const row = findDemoNodeRow(targetId);
      if (!row) return null;
      const project = findDemoProjectRow(row.projectId);
      return project && canSeeProject(project, currentAuthUser)
        ? valuesRecord(row.customFields, nodeSystem(row))
        : null;
    }
    default:
      return null;
  }
}

/** Запись самого хоста (self): значения + системные поля сущности. */
function hostRecord(host: DemoFormulaHost): FormulaRecord {
  switch (host.kind) {
    case 'task': {
      const task = findDemoTask(host.id);
      return task ? taskRecord(task) : valuesRecord(host.customFields);
    }
    case 'letter': {
      const letter = findLetter(host.id);
      return letter
        ? valuesRecord(letter.customFields, letterSystem(letter))
        : valuesRecord(host.customFields);
    }
    case 'project': {
      const row = findDemoProjectRow(host.id);
      return row
        ? valuesRecord(projectCustomFieldsOf(row), projectSystem(row))
        : valuesRecord(host.customFields);
    }
    case 'node': {
      const row = findDemoNodeRow(host.id);
      return row
        ? valuesRecord(row.customFields, nodeSystem(row))
        : valuesRecord(host.customFields);
    }
  }
}

/** Демо-резолвер хоста: null — записи нет (эндпоинт отвечает 404). */
export function demoResolver(kind: FormulaHostKind, hostId: string): FormulaResolver | null {
  const host = findFormulaHost(kind, hostId);
  if (!host) return null;
  return resolverForHost(host);
}

/** Резолвер хоста: единая сборка источников для записи мок-мира.
 *  Экспорт — резолвер создания (`formula-creation-resolver.ts`). */
export function resolverForHost(host: DemoFormulaHost): FormulaResolver {
  const kind = host.kind;
  return {
    single(source) {
      switch (source.kind) {
        case 'self':
          return hostRecord(host);
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
