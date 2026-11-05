import type { WorkflowCondition, WorkflowDocument, WorkflowValidator } from '@nodus/contracts';

import { fieldIds } from './field-ids.js';
import {
  stageCancelled,
  stageDone,
  stageInProgress,
  stageNew,
  stageOnControl,
  stagePaused,
  stagePostponed,
} from './task-stages.js';

/** Документы маршрутов мок-библиотеки (#378, #380) — зеркало каталога API.
 *  Вынесены из workflows.ts (I5: файл данных перерос 300 строк). */

const trid = (code: string): string =>
  `30000000-0000-4000-8000-${code.padEnd(12, '0').slice(0, 12)}`;

/** Правила-сокращения ревизии 2. */
const doers: WorkflowCondition = { kind: 'role_in', roles: ['assignee', 'coexecutor'] };
const executor: WorkflowCondition = { kind: 'role_in', roles: ['assignee'] };
const creator: WorkflowCondition = { kind: 'role_in', roles: ['creator'] };
const owners: WorkflowCondition = { kind: 'role_in', roles: ['assignee', 'creator'] };
const allHands: WorkflowCondition = {
  kind: 'role_in',
  roles: ['assignee', 'coexecutor', 'creator'],
};
const noOpenSubtasks: WorkflowValidator = { kind: 'no_open_subtasks' };

/** «Стандартный» (task.default): Ожидает → В работе → На утверждении →
 *  Завершена; Приостановлена/Отложена; Отменена. Кнопка «Отменить» —
 *  «из любого», в меню, у постановщика (решения владельца 4–6). */
export const standardDocument: WorkflowDocument = {
  stages: [
    { ...stageNew, code: 'new', outcome: null, isInitial: true, sortOrder: 0 },
    { ...stageInProgress, code: 'in_progress', outcome: null, isInitial: false, sortOrder: 0 },
    { ...stagePaused, code: 'paused', outcome: null, isInitial: false, sortOrder: 0 },
    { ...stagePostponed, code: 'postponed', outcome: null, isInitial: false, sortOrder: 1 },
    { ...stageOnControl, code: 'on_control', outcome: null, isInitial: false, sortOrder: 0 },
    { ...stageDone, code: 'done', outcome: 'success', isInitial: false, sortOrder: 0 },
    { ...stageCancelled, code: 'cancelled', outcome: 'cancelled', isInitial: false, sortOrder: 1 },
  ],
  transitions: [
    {
      id: trid('start'),
      code: 'start',
      name: 'Взять в работу',
      fromStageId: stageNew.id,
      toStageId: stageInProgress.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [doers], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('complete'),
      code: 'complete',
      name: 'Завершить',
      fromStageId: stageInProgress.id,
      toStageId: stageOnControl.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: {
        conditions: [executor],
        validators: [
          noOpenSubtasks,
          // Демо кастомного поля в гейте (#431): «Заполнены поля» —
          // «№ накладной» задачи.
          { kind: 'fields_required', fields: [`cf.${fieldIds.invoiceNumber}`] },
        ],
        postFunctions: [{ kind: 'route_if', when: 'approver_is_actor', toStageId: stageDone.id }],
      },
      // Окно «Завершение» показывает поле процесса в разделе «Поля» (#431).
      form: {
        enabled: true,
        title: 'Завершение работы',
        sections: [
          { kind: 'fields', fields: ['description', `cf.${fieldIds.invoiceNumber}`] },
          { kind: 'result' },
          { kind: 'comment', label: 'Комментарий', required: false },
        ],
      },
    },
    {
      id: trid('pause'),
      code: 'pause',
      name: 'Приостановить',
      fromStageId: stageInProgress.id,
      toStageId: stagePaused.id,
      display: 'button',
      intent: 'service',
      sortOrder: 1,
      rules: { conditions: [doers], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('continue'),
      code: 'continue',
      name: 'Продолжить',
      fromStageId: stagePaused.id,
      toStageId: stageInProgress.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [doers], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('postpone'),
      code: 'postpone',
      name: 'Отложить',
      fromStageId: stagePaused.id,
      toStageId: stagePostponed.id,
      display: 'button',
      intent: 'service',
      sortOrder: 1,
      rules: { conditions: [owners], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('resume'),
      code: 'resume',
      name: 'Вернуть в работу',
      fromStageId: stagePostponed.id,
      toStageId: stageInProgress.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [allHands], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('accept'),
      code: 'accept',
      name: 'Утвердить',
      fromStageId: stageOnControl.id,
      toStageId: stageDone.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [creator], validators: [noOpenSubtasks], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('return_control'),
      code: 'return_control',
      name: 'Вернуть на доработку',
      fromStageId: stageOnControl.id,
      toStageId: stageInProgress.id,
      display: 'button',
      intent: 'action',
      sortOrder: 1,
      rules: { conditions: [creator], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('return_done'),
      code: 'return_done',
      name: 'Возобновить',
      fromStageId: stageDone.id,
      toStageId: stageInProgress.id,
      display: 'button',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [owners], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('cancel'),
      code: 'cancel',
      name: 'Отменить',
      fromStageId: null,
      toStageId: stageCancelled.id,
      display: 'menu',
      intent: 'service',
      sortOrder: 0,
      rules: { conditions: [creator], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('reopen'),
      code: 'reopen',
      name: 'Восстановить',
      fromStageId: stageCancelled.id,
      toStageId: stageNew.id,
      display: 'button',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [creator], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
  ],
};

/** «Быстрый» (task.quick): без «На утверждении»; можно завершить прямо из
 *  «Ожидает». */
export const quickDocument: WorkflowDocument = {
  stages: standardDocument.stages.filter((s) => s.code !== 'on_control'),
  transitions: [
    standardDocument.transitions.find((t) => t.code === 'start')!,
    {
      id: trid('complete'),
      code: 'complete',
      name: 'Завершить',
      fromStageId: stageInProgress.id,
      toStageId: stageDone.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [executor], validators: [noOpenSubtasks], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('complete_waiting'),
      code: 'complete_waiting',
      name: 'Завершить',
      fromStageId: stageNew.id,
      toStageId: stageDone.id,
      display: 'button',
      intent: 'action',
      sortOrder: 1,
      rules: { conditions: [executor], validators: [noOpenSubtasks], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    ...(
      ['pause', 'continue', 'postpone', 'resume', 'return_done', 'cancel', 'reopen'] as const
    ).map((code) => standardDocument.transitions.find((t) => t.code === code)!),
  ],
};

/** Простой документ архивного демо-типа: Ожидает → В работе → Завершена. */
export const simpleDocument: WorkflowDocument = {
  stages: [
    { ...stageNew, code: 'new', outcome: null, isInitial: true, sortOrder: 0 },
    { ...stageInProgress, code: 'in_progress', outcome: null, isInitial: false, sortOrder: 0 },
    { ...stageDone, code: 'done', outcome: 'success', isInitial: false, sortOrder: 0 },
  ],
  transitions: [
    {
      id: trid('start'),
      code: 'start',
      name: 'Взять в работу',
      fromStageId: stageNew.id,
      toStageId: stageInProgress.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [executor], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
    {
      id: trid('complete'),
      code: 'complete',
      name: 'Завершить',
      fromStageId: stageInProgress.id,
      toStageId: stageDone.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [executor], validators: [], postFunctions: [] },
      form: { enabled: false, sections: [] },
    },
  ],
};
