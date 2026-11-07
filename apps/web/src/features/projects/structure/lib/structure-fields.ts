import { useMemo } from 'react';
import { ui } from '@nodus/contracts';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { attributeFieldDefs } from '../../../../shared/views/attribute-fields.js';
import { LEADING_COL_W } from '../../../../shared/views/row-menu.js';
import type { FieldDef, ViewField } from '../../../../shared/views/use-view-fields.js';

/** Реестр колонок таблицы структуры (#467): узлы заполняют шифр/часы/сроки/
 *  прогресс поддерева, задачи — стадию/ответственного/срок/факт; общие
 *  колонки — единая сетка разнородных строк (проводник: у папок и файлов
 *  одни колонки, пустые ячейки просто пустые, без дефисов). План и факт —
 *  отдельные колонки (не одно поле с двумя числами). По умолчанию — пять
 *  колонок, которые влезают в рабочую зону карточки; ответственный, стадия,
 *  шифр и поздний срок — в шестерёнке. */
export const STRUCTURE_VIEW_KEY = 'projects.structure.v2';

export const structureFields: FieldDef[] = [
  {
    id: 'name',
    label: ui.structure.columnName,
    defaultVisible: true,
    defaultWidth: 260,
    minWidth: 220,
    maxWidth: 640,
    locked: true,
  },
  {
    id: 'progress',
    label: ui.structure.columnProgress,
    defaultVisible: true,
    defaultWidth: 84,
    minWidth: 76,
  },
  {
    id: 'plan',
    label: ui.structure.columnPlan,
    defaultVisible: true,
    defaultWidth: 74,
    minWidth: 68,
  },
  {
    id: 'fact',
    label: ui.structure.columnFact,
    defaultVisible: true,
    defaultWidth: 74,
    minWidth: 68,
  },
  {
    id: 'deadline',
    label: ui.structure.columnDeadline,
    defaultVisible: true,
    defaultWidth: 74,
    minWidth: 70,
  },
  {
    id: 'assignee',
    label: ui.tasks.assignee,
    defaultVisible: false,
    defaultWidth: 136,
    minWidth: 104,
  },
  {
    id: 'stage',
    label: ui.tasks.fieldStage,
    defaultVisible: false,
    defaultWidth: 120,
    minWidth: 112,
  },
  {
    id: 'code',
    label: ui.structure.columnCode,
    defaultVisible: false,
    defaultWidth: 80,
    minWidth: 56,
    maxWidth: 128,
  },
  {
    id: 'latest',
    label: ui.structure.columnLatest,
    defaultVisible: false,
    defaultWidth: 120,
    minWidth: 96,
  },
];

/** Общий трек сетки строк и хедера: ведущая колонка + поля. Вложенность —
 *  отступами в ячейке названия (проводник), отдельной колонки графа нет. */
export function structureGrid(fields: readonly ViewField<FieldDef>[]): string {
  return `${LEADING_COL_W}px ${fields.map((f) => `${f.width ?? 120}px`).join(' ')}`;
}

/**
 * Колонки структуры + атрибуты (#632): в дереве живут ДВА носителя значений —
 * папки (атрибуты видов папок) и задачи-листья (атрибуты задач), поэтому
 * реестр собирается из обоих списков. Один атрибут может быть привязан и к
 * виду папки, и к типу задачи — тогда колонка ОДНА (дедуп по `cf.<id>`:
 * ячейка папки читает значение папки, ячейка задачи — значение задачи).
 * Атрибуты скрыты по умолчанию: дерево остаётся пятью колонками, остальное —
 * в шестерёнке.
 */
export function buildStructureFields(attributes: readonly FieldDef[]): FieldDef[] {
  const seen = new Set(structureFields.map((field) => field.id));
  const extra: FieldDef[] = [];
  for (const field of attributes) {
    if (seen.has(field.id)) continue;
    seen.add(field.id);
    extra.push(field);
  }
  return [...structureFields, ...extra];
}

/** Реестр колонок структуры с атрибутами папок и задач (#632): определения
 *  обоих модулей грузятся один раз на операцию (кэш query). */
export function useStructureFields(): FieldDef[] {
  const taskDefinitions = useCustomFieldDefinitions('task');
  const nodeDefinitions = useCustomFieldDefinitions('node');
  return useMemo(
    () =>
      buildStructureFields([
        ...attributeFieldDefs({ definitions: taskDefinitions.data, module: 'task' }),
        ...attributeFieldDefs({ definitions: nodeDefinitions.data, module: 'node' }),
      ]),
    [taskDefinitions.data, nodeDefinitions.data],
  );
}
