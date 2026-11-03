import type { CatalogStage, CatalogProcessType, CatalogWorkflow } from './system-catalog.js';
import { commentWindow, resultWindow } from './catalog-forms.js';
import { TASK_CATALOG_REVISION } from './catalog-revisions.js';

/** Тип «Быстрый» (#378, ревизия 2): без этапа «Утверждение» — завершение
 *  сразу в «Завершена». Стадии — общие константы system-catalog.ts. */
export const QUICK_PROCESS_TYPE: CatalogProcessType = {
  code: 'quick',
  name: 'Быстрый',
  category: 'task',
  icon: 'zap',
  color: 'success',
  description: 'Без утверждения — для мелких поручений',
  sortOrder: 1,
};

export function buildQuickWorkflow(stages: {
  newStage: CatalogStage;
  inProgress: CatalogStage;
  paused: CatalogStage;
  postponed: CatalogStage;
  done: CatalogStage;
  cancelled: CatalogStage;
}): CatalogWorkflow {
  return {
    code: 'task.quick',
    name: 'Быстрый',
    kind: 'task',
    revision: TASK_CATALOG_REVISION,
    stages: [
      stages.newStage,
      stages.inProgress,
      stages.paused,
      stages.postponed,
      stages.done,
      stages.cancelled,
    ],
    transitions: [
      {
        code: 'start',
        name: 'Взять в работу',
        from: 'new',
        to: 'in_progress',
        display: 'primary',
        rules: { conditions: [{ kind: 'role_in', roles: ['assignee', 'coexecutor'] }] },
      },
      {
        code: 'complete',
        name: 'Завершить',
        from: 'in_progress',
        to: 'done',
        display: 'primary',
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [{ kind: 'no_open_subtasks' }],
        },
        form: resultWindow(),
      },
      {
        code: 'complete_waiting',
        name: 'Завершить',
        from: 'new',
        to: 'done',
        display: 'button',
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [{ kind: 'no_open_subtasks' }],
        },
        form: resultWindow(),
      },
      {
        code: 'pause',
        name: 'Приостановить',
        from: 'in_progress',
        to: 'paused',
        display: 'button',
        intent: 'service',
        rules: { conditions: [{ kind: 'role_in', roles: ['assignee', 'coexecutor'] }] },
        form: commentWindow('Причина приостановки', true),
      },
      {
        code: 'continue',
        name: 'Продолжить',
        from: 'paused',
        to: 'in_progress',
        display: 'primary',
        rules: { conditions: [{ kind: 'role_in', roles: ['assignee', 'coexecutor'] }] },
      },
      {
        code: 'postpone',
        name: 'Отложить',
        from: 'paused',
        to: 'postponed',
        display: 'button',
        intent: 'service',
        rules: { conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }] },
      },
      {
        code: 'resume',
        name: 'Вернуть в работу',
        from: 'postponed',
        to: 'in_progress',
        display: 'primary',
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee', 'coexecutor', 'creator'] }],
        },
      },
      {
        code: 'return_done',
        name: 'Возобновить',
        from: 'done',
        to: 'in_progress',
        display: 'button',
        rules: { conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }] },
      },
      {
        code: 'cancel',
        name: 'Отменить',
        from: null,
        to: 'cancelled',
        display: 'menu',
        intent: 'service',
        rules: { conditions: [{ kind: 'role_in', roles: ['creator'] }] },
        form: commentWindow('Причина отмены', true),
      },
      {
        code: 'reopen',
        name: 'Восстановить',
        from: 'cancelled',
        to: 'new',
        display: 'button',
        rules: { conditions: [{ kind: 'role_in', roles: ['creator'] }] },
      },
    ],
  };
}
