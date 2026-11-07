import type {
  CustomFieldValues,
  LetterDetail,
  LetterListItem,
  ProjectDetail,
  ProjectListItem,
  ProjectNode,
  TaskDetail,
  TaskListItem,
} from '@nodus/contracts';

import type { AttributeRow } from '../attribute-carrier.js';
import { demoRefsForValues } from '../../mocks/data/custom-fields-refs.js';
import { taskDetailOf } from '../../mocks/data/tasks.js';

import { applyTypeFormulas, typeFormulaSlots } from './formula-mocks.js';

/** DTO сущностей с формулами типа/вида (#632, Р6): формулы считаются на
 *  ЧТЕНИИ, поэтому хендлеры мок-мира клонируют DTO и накладывают результат —
 *  хранимые демо-данные не мутируются. Одна обёртка на носителя. */

/** Строка списка задач с формулами типа и ссылками значений (#632, Р9). */
export function taskWithFormulas(task: TaskListItem): TaskListItem {
  const computed = applyTypeFormulas(
    'task',
    { id: task.id, customFields: task.customFields ?? {} },
    typeFormulaSlots('task', task.type.id),
  );
  return {
    ...task,
    customFields: computed.customFields,
    customFieldFormulas: computed.customFieldFormulas,
    customFieldRefs: demoRefsForValues(computed.customFields),
  };
}

/** Деталь задачи с формулами типа (клонированный DTO). */
export function taskDetailWithFormulas(task: TaskListItem): TaskDetail {
  const detail = taskDetailOf(task);
  const computed = applyTypeFormulas(
    'task',
    { id: task.id, customFields: detail.customFields },
    typeFormulaSlots('task', task.type.id),
  );
  return {
    ...detail,
    customFields: computed.customFields,
    customFieldFormulas: computed.customFieldFormulas,
    customFieldRefs: demoRefsForValues(computed.customFields),
  };
}

/** Деталь письма с формулами типа (клонированный DTO). */
export function letterWithFormulas(letter: LetterDetail): LetterDetail {
  const computed = applyTypeFormulas(
    'letter',
    { id: letter.id, customFields: letter.customFields },
    typeFormulaSlots('letter', letter.type.id),
  );
  return {
    ...letter,
    customFields: computed.customFields,
    customFieldFormulas: computed.customFieldFormulas,
  };
}

/** Строка списка писем с формулами типа и именами ссылок значений (#632,
 *  Р9): списку нужны те же значения/refs/формулы, что карточке — колонки
 *  атрибутов и значок fx живут строкой. Значения передаёт вызывающий: DTO
 *  строки списка собирается из демо-записи письма. */
export function letterListItemWithFormulas(
  item: LetterListItem,
  values: CustomFieldValues,
): AttributeRow<LetterListItem> {
  const computed = applyTypeFormulas(
    'letter',
    { id: item.id, customFields: values },
    typeFormulaSlots('letter', item.typeId),
  );
  return {
    ...item,
    customFields: computed.customFields,
    customFieldFormulas: computed.customFieldFormulas,
    customFieldRefs: demoRefsForValues(computed.customFields),
  };
}

/** Узел структуры с формулами вида папки (клонированный DTO). */
export function nodeWithFormulas(node: ProjectNode, kindId: string): ProjectNode {
  const computed = applyTypeFormulas(
    'node',
    { id: node.id, customFields: node.customFields },
    typeFormulaSlots('node', kindId),
  );
  return {
    ...node,
    customFields: computed.customFields,
    customFieldFormulas: computed.customFieldFormulas,
  };
}

/** Карточка проекта с формулами типа проекта (клонированный DTO). */
export function projectWithFormulas(project: ProjectDetail, typeId: string): ProjectDetail {
  const computed = applyTypeFormulas(
    'project',
    { id: project.id, customFields: project.customFields },
    typeFormulaSlots('project', typeId),
  );
  return {
    ...project,
    customFields: computed.customFields,
    customFieldFormulas: computed.customFieldFormulas,
    customFieldRefs: demoRefsForValues(computed.customFields),
  };
}

/** Строка журнала проектов с формулами типа проекта и именами ссылок
 *  значений (#632, Р9): колонки атрибутов и значок fx живут строкой списка. */
export function projectListItemWithFormulas(
  item: ProjectListItem,
  values: CustomFieldValues,
): AttributeRow<ProjectListItem> {
  const computed = applyTypeFormulas(
    'project',
    { id: item.id, customFields: values },
    typeFormulaSlots('project', item.type?.id),
  );
  return {
    ...item,
    customFields: computed.customFields,
    customFieldFormulas: computed.customFieldFormulas,
    customFieldRefs: demoRefsForValues(computed.customFields),
  };
}
