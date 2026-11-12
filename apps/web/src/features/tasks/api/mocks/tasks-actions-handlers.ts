import type { TaskListItem, WorkflowAction } from '@nodus/contracts';
import {
  effectiveWindowSections,
  ErrorCode,
  executeTransitionBodySchema,
  ui,
} from '@nodus/contracts';
import { http, HttpResponse } from 'msw';

import { applyDemoPatch } from '../../../../shared/mocks/data/custom-fields-rules.js';
import { addTaskLocks } from '../../../../shared/mocks/data/task-locks.js';
import { currentAuthUser } from '../../../../shared/mocks/data/users.js';
import { documentOfTask, findTask, transitionsOf } from './tasks-transitions-handlers.js';
import {
  applyForm,
  checkWindow,
  postActionBlock,
  windowLockDenial,
} from './tasks-transitions-gates.js';

/**
 * Действия маршрута в мок-мире (#633): кнопки без смены статуса. Грамматика
 * та же, что у сервера: видимость в демо — всем, окно проверяется, статус не
 * меняется, в ленту уходит блок «Действие». Вынесено из обработчиков
 * переходов ради лимита файла (I5).
 */

/** Действия статуса: свои раньше «из любого», действия с шагами пока не
 *  исполняются и в карточку не попадают (как на сервере). */
function actionsOf(task: TaskListItem): WorkflowAction[] {
  const route = documentOfTask(task);
  return (route.actions ?? [])
    .filter((a) => a.stageId === null || a.stageId === task.stage.id)
    .filter((a) => a.steps.length === 0)
    .sort(
      (a, b) =>
        Number(a.stageId === null) - Number(b.stageId === null) || a.sortOrder - b.sortOrder,
    )
    .map((a) => ({
      id: a.id,
      name: a.name,
      display: a.display,
      form: a.form.enabled ? a.form : null,
      blockedBy: [],
      validators: a.rules.validators,
    }));
}

export const tasksActionsHandlers = [
  http.get('/api/v1/tasks/:id/actions', ({ params }) => {
    const task = findTask(String(params.id));
    if (!task)
      return HttpResponse.json(
        { code: ErrorCode.NOT_FOUND, message: 'Task not found' },
        { status: 404 },
      );
    return HttpResponse.json(actionsOf(task));
  }),

  http.post('/api/v1/tasks/:id/actions/:actionId/press', async ({ params, request }) => {
    const task = findTask(String(params.id));
    const action = task ? actionsOf(task).find((a) => a.id === params.actionId) : undefined;
    if (!task || !action) {
      return HttpResponse.json(
        { code: ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED, message: 'Action not allowed' },
        { status: 409 },
      );
    }
    const parsed = executeTransitionBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 400 },
      );
    }
    const form = parsed.data.form ?? {};
    const sections = effectiveWindowSections(action.form, { validators: [] });
    const check = checkWindow(sections, form);
    if (check.missing.length > 0 || check.unexpected.length > 0) {
      return HttpResponse.json(
        {
          code: ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
          message: ui.tasks.transitionNeedsWindow,
          details: { transitionId: action.id, ...check },
        },
        { status: 422 },
      );
    }
    const customPatch = form.fields?.customFields;
    if (customPatch) {
      const { issues } = applyDemoPatch(task.customFields, customPatch);
      if (issues.length > 0) {
        return HttpResponse.json(
          {
            code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
            message: 'Custom field value is invalid',
            details: { issues },
          },
          { status: 422 },
        );
      }
    }
    const lockedWrite = windowLockDenial(task, sections, form);
    if (lockedWrite) return lockedWrite;
    applyForm(task, form);
    postActionBlock(task, action, form);
    if (action.form?.enabled) {
      addTaskLocks(task.id, action.form.locks ?? [], {
        lockedAt: new Date().toISOString(),
        lockedBy: currentAuthUser.id,
        source: { kind: 'transition', transitionId: action.id, name: action.name },
      });
    }
    task.updatedAt = new Date().toISOString();
    // Статус не меняется — карточка и кнопки обновляются одним ходом.
    return HttpResponse.json({ task, transitions: transitionsOf(task) });
  }),
];
