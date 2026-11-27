import type {
  ConditionPredicate,
  ConditionQuery,
  TaskListItem,
  TransitionBlockReason,
  WorkflowDocument,
  WorkflowValidatorDto,
} from '@nodus/contracts';
import { CONDITION_LIMITS, isFinalState } from '@nodus/contracts';

import { demoNodeRows } from '../../../../shared/mocks/data/project-nodes.js';
import { demoSubtasks, demoTasks } from '../../../../shared/mocks/data/tasks.js';
import {
  CHANGE_WORKFLOW_ID,
  changeType,
  demoWorkflowDetails,
  KOMPLEKT_WORKFLOW_ID,
  komplektType,
  quickDocument,
  standardDocument,
} from '../../../../shared/mocks/data/workflows.js';
import { quickProcessType, requestProcessType } from '../../../../shared/mocks/data/task-stages.js';
import { requestDocument } from '../../../../shared/mocks/data/request-workflow-document.js';

/**
 * Проверки общей выборки (#635) в мок-мире задач: субъекты выборки →
 * живые демо-записи, квантор, причина с записями-ссылками (как сервер).
 * Формулы мок не считает (сервер считает) — проверка formula всегда
 * пропускает. Субъекты мок-мира без данных (связи, папки как записи,
 * проект, ссылки из полей) пропускаются: демо на них не ссылается.
 */

/** Маршрут типа задачи в мок-мире (зеркало documentOfTask без цикла). */
function documentOfTypeRef(typeId: string): WorkflowDocument {
  if (typeId === quickProcessType.id) return quickDocument;
  if (typeId === requestProcessType.id) return requestDocument;
  if (typeId === komplektType.id) return demoWorkflowDetails[KOMPLEKT_WORKFLOW_ID]!.document;
  if (typeId === changeType.id) return demoWorkflowDetails[CHANGE_WORKFLOW_ID]!.document;
  return standardDocument;
}

/** «Результат выдан» у записи (#635, §11): стадия ∈ отмеченным маршрута её
 *  типа; без отметок «выдана» = закрыта успешно. */
function resultIssuedOf(task: TaskListItem): boolean {
  const doc = documentOfTypeRef(task.type.id);
  const marked = new Set(doc.stages.filter((stage) => stage.resultIssued).map((s) => s.id));
  if (marked.size > 0) return marked.has(task.stage.id);
  return isFinalState(task.stage.systemState) && task.stage.outcome === 'success';
}

function predicateHolds(task: TaskListItem, predicate: ConditionPredicate): boolean {
  switch (predicate.kind) {
    case 'type_is':
      return task.type.id === predicate.typeId;
    case 'stage_is':
      return task.stage.id === predicate.stageId;
    case 'system_state':
      return task.stage.systemState === predicate.state;
    case 'outcome':
      return isFinalState(task.stage.systemState) && task.stage.outcome === predicate.outcome;
    case 'result_issued':
      return resultIssuedOf(task);
    case 'field':
      // Значения полей в выборке мок не оценивает (сервер — по живым
      // данным); выборки демо-маршрутов этим предикатом не пользуются.
      return true;
  }
}

/** Записи субъекта выборки; null — субъект вне мок-мира (проверка пропущена). */
function selectionOf(task: TaskListItem, query: ConditionQuery): TaskListItem[] | null {
  const subject = query.subject;
  switch (subject.kind) {
    case 'self':
      return [task];
    case 'parent_task':
      return demoTasks.filter((t) => t.id === task.parentId);
    case 'subtasks':
      return demoSubtasks[task.id] ?? [];
    case 'project_tasks':
      return demoTasks.filter((t) => t.project?.id === task.project?.id);
    case 'folder_tasks':
      return task.nodeId === null
        ? []
        : demoTasks.filter((t) => t.nodeId === task.nodeId && t.id !== task.id);
    case 'folder_type_tasks': {
      // Работы в папках указанного вида во всём проекте записи.
      const nodes = new Set(
        demoNodeRows
          .filter((row) => row.kindId === subject.folderTypeId)
          .filter((row) => task.project === null || row.projectId === task.project.id)
          .map((row) => row.id),
      );
      return demoTasks.filter((t) => t.nodeId !== null && nodes.has(t.nodeId));
    }
    default:
      return null;
  }
}

/** Причина непройденной проверки records/formula; null — проверка пройдена
 *  (или вне мок-мира). Записи в причине — видимые демо-актору (все), счётчик
 *  невидимых нулевой: «и ещё N» покажет живой сервер с реальной видимостью.
 *  totalCount — полный состав нарушителей, как у сервера (#635). */
export function conditionGateReasonOf(
  task: TaskListItem,
  validator: WorkflowValidatorDto,
): TransitionBlockReason | null {
  if (validator.kind === 'formula') return null;
  if (validator.kind !== 'records') return null;
  const records = selectionOf(task, validator.query);
  if (records === null) return null;
  const matching = records.filter((record) =>
    validator.query.where.every((predicate) => predicateHolds(record, predicate)),
  );
  let violators: TaskListItem[];
  switch (validator.query.quantifier) {
    case 'all':
      violators = records.filter((record) => !matching.includes(record));
      break;
    case 'any':
      // «Хотя бы одна» без подходящей записи: назвать нечего — подпись.
      violators = [];
      break;
    case 'none':
      violators = matching;
      break;
  }
  const blocked =
    validator.query.quantifier === 'any' ? matching.length === 0 : violators.length > 0;
  if (!blocked) return null;
  const shown = violators.slice(0, CONDITION_LIMITS.reasonRecords);
  return {
    kind: 'records',
    title: validator.title,
    records: shown.map((record) => ({
      id: record.id,
      entityKind: 'task' as const,
      name: record.title,
    })),
    hiddenCount: 0,
    totalCount: violators.length,
  };
}

/** Все причины проверок общей выборки кнопки (мок blockedBy). */
export function conditionGateReasonsOf(
  task: TaskListItem,
  validators: readonly WorkflowValidatorDto[],
): TransitionBlockReason[] {
  return validators.flatMap((validator) => {
    const reason = conditionGateReasonOf(task, validator);
    return reason ? [reason] : [];
  });
}
