import type {
  CustomFieldDefinition,
  CustomFieldValue,
  CustomFieldValues,
  FormulaHostKind,
  FormulaNode,
} from '@nodus/contracts';
import type { FormulaCellError, FormulaRegistryMeta } from '@nodus/formula-engine';

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { findLetter } from '../../mocks/data/letters.js';
import { findDemoNodeRow } from '../../mocks/data/project-nodes.js';
import { findDemoProjectRow } from '../../mocks/data/projects.js';
import { projectCustomFieldsOf } from '../../mocks/data/project-views.js';
import { demoSubtasks, demoTasks } from '../../mocks/data/tasks.js';

/** Состояние формул мок-мира (#632): ячейки собственных формул и хост.
 *  Чтение данных формулой — `formula-resolver.ts`, применение формул типа
 *  и CRUD ячейки — `formula-mocks.ts` (лимит I5 делит файл по ролям).
 *
 *  Хранение: ячейка = «значение ИЛИ формула». Собственная формула пишет
 *  материализованное значение в `customFields` хоста (снимок) и живёт в
 *  карте ниже — поэтому фильтры/ссылки читают значение без формульных
 *  веток. Формулы типа/вида не хранятся: считаются на чтении (Р6). */

/** Ячейка собственной формулы: AST, ошибка вычисления и последнее значение. */
export interface FormulaCell {
  ast: FormulaNode;
  error: FormulaCellError | null;
  value: CustomFieldValue | null;
}

/** Карта собственных формул: `${hostKind}:${hostId}:${fieldId}`. */
const cells = new Map<string, FormulaCell>();

function cellKey(kind: FormulaHostKind, hostId: string, fieldId: string): string {
  return `${kind}:${hostId}:${fieldId}`;
}

export function readFormulaCell(
  kind: FormulaHostKind,
  hostId: string,
  fieldId: string,
): FormulaCell | undefined {
  return cells.get(cellKey(kind, hostId, fieldId));
}

export function writeFormulaCell(
  kind: FormulaHostKind,
  hostId: string,
  fieldId: string,
  cell: FormulaCell,
): void {
  cells.set(cellKey(kind, hostId, fieldId), cell);
}

/** Снять формулу ячейки (значение-снимок остаётся, Р5). */
export function dropFormulaCell(kind: FormulaHostKind, hostId: string, fieldId: string): boolean {
  return cells.delete(cellKey(kind, hostId, fieldId));
}

/** Собственные формулы хоста: fieldId → ячейка (DTO `origin: 'own'`). */
export function ownCellsOf(kind: FormulaHostKind, hostId: string): Map<string, FormulaCell> {
  const prefix = `${kind}:${hostId}:`;
  const out = new Map<string, FormulaCell>();
  for (const [key, cell] of cells) {
    if (!key.startsWith(prefix)) continue;
    out.set(key.slice(prefix.length), cell);
  }
  return out;
}

/** Сброс состояния (тесты): мир возвращается к демо-данным без формул. */
export function resetFormulaCells(): void {
  cells.clear();
}

/** Хост формулы мок-мира: запись-носитель и контекст источников. */
export interface DemoFormulaHost {
  kind: FormulaHostKind;
  id: string;
  customFields: CustomFieldValues;
  /** Проект записи (источник `project`, фильтр видимости). */
  projectId: string | null;
  /** Узел структуры (источник `folder_nearest`, выборка `node_tasks`). */
  nodeId: string | null;
  /** Родительская задача (источник `parent_task`). */
  parentId: string | null;
}

/** Задача по id: общий список + свежесозданные подзадачи (демо-мир). */
export function findDemoTask(id: string) {
  return (
    demoTasks.find((task) => task.id === id) ??
    Object.values(demoSubtasks)
      .flat()
      .find((task) => task.id === id)
  );
}

/** Запись-носитель по виду и id; null — хоста нет (404 у мок-сервера). */
export function findFormulaHost(kind: FormulaHostKind, id: string): DemoFormulaHost | null {
  switch (kind) {
    case 'task': {
      const task = findDemoTask(id);
      if (!task) return null;
      return {
        kind,
        id,
        customFields: task.customFields ?? {},
        projectId: task.project?.id ?? null,
        nodeId: task.nodeId ?? null,
        parentId: task.parentId ?? null,
      };
    }
    case 'letter': {
      const letter = findLetter(id);
      if (!letter) return null;
      return {
        kind,
        id,
        customFields: letter.customFields,
        projectId: letter.project?.id ?? null,
        nodeId: null,
        parentId: null,
      };
    }
    case 'project': {
      const row = findDemoProjectRow(id);
      if (!row) return null;
      return {
        kind,
        id,
        customFields: projectCustomFieldsOf(row),
        projectId: row.id,
        nodeId: null,
        parentId: null,
      };
    }
    case 'node': {
      const row = findDemoNodeRow(id);
      if (!row) return null;
      return {
        kind,
        id,
        customFields: row.customFields,
        projectId: row.projectId,
        nodeId: row.id,
        parentId: null,
      };
    }
  }
}

/** Записать значения хоста (формула материализует результат в значение).
 *  Задачи живут в отдельном сторе значений (ленивый геттер tasks.ts) —
 *  присваивание в элемент списка уходит в сеттер. */
export function setHostValues(
  kind: FormulaHostKind,
  id: string,
  values: CustomFieldValues,
): boolean {
  switch (kind) {
    case 'task': {
      const task = findDemoTask(id);
      if (!task) return false;
      task.customFields = values;
      return true;
    }
    case 'letter': {
      const letter = findLetter(id);
      if (!letter) return false;
      letter.customFields = values;
      return true;
    }
    case 'project': {
      const row = findDemoProjectRow(id);
      if (!row) return false;
      row.customFields = values;
      return true;
    }
    case 'node': {
      const row = findDemoNodeRow(id);
      if (!row) return false;
      row.customFields = values;
      return true;
    }
  }
}

/** Определение атрибута по внутреннему номеру (адрес формулы, Р2). */
export function fieldByNumber(number: number): CustomFieldDefinition | undefined {
  return demoCustomFieldDefinitions.find((definition) => definition.number === number);
}

/** Мета реестра для статического тайпинга формулы: number → тип. */
export function demoFormulaMeta(): FormulaRegistryMeta {
  const byNumber = new Map<
    number,
    { number: number; type: CustomFieldDefinition['type']; dictionaryId: string | null }
  >();
  for (const definition of demoCustomFieldDefinitions) {
    byNumber.set(definition.number, {
      number: definition.number,
      type: definition.type,
      dictionaryId: definition.settings.dictionaryId ?? null,
    });
  }
  return { byNumber };
}
