import type {
  LetterDetail,
  ProjectDetail,
  ProjectNode,
  TaskDetail,
  TaskListItem,
} from '@nodus/contracts';

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
