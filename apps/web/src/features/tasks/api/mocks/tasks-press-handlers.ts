import type { TaskListItem, TransitionFormInput, WorkflowTransition } from '@nodus/contracts';
import { effectiveWindowSections, ErrorCode, pressSubmitBodySchema, ui } from '@nodus/contracts';
import { http, HttpResponse } from 'msw';

import { pressOf, submitPress, withdrawPress } from '../../../../shared/mocks/data/press.js';
import {
  autoMovePersonalPlacement,
  demoPersonalStages,
  demoSubtasks,
  demoTasks,
  taskDetailOf,
} from '../../../../shared/mocks/data/tasks.js';
import { addTaskLocks } from '../../../../shared/mocks/data/task-locks.js';
import { currentAuthUser } from '../../../../shared/mocks/data/users.js';
import {
  applyForm,
  blockedByOf,
  checkWindow,
  postBlock,
  windowLockDenial,
} from './tasks-transitions-gates.js';
import {
  documentOfTask,
  resolveTarget,
  transitionsOf,
} from './tasks-transitions-handlers.js';

const notFound = () =>
  HttpResponse.json(
    { code: ErrorCode.NOT_FOUND, message: 'Press round not found' },
    { status: 404 },
  );

const noRights = () =>
  HttpResponse.json(
    { code: ErrorCode.FORBIDDEN, message: 'Press action is not allowed' },
    { status: 403 },
  );

function findTask(id: string): TaskListItem | undefined {
  return (
    demoTasks.find((t) => t.id === id) ??
    Object.values(demoSubtasks)
      .flat()
      .find((t) => t.id === id)
  );
}

/** Последняя отметка двигает задачу по её обычному переходу (#434). В моке
 *  применяется ввод последнего нажавшего (реальный сервер применит ввод
 *  каждого в своей транзакции); замки окна ставятся как у обычного перехода. */
function applyCollectiveTransition(
  task: TaskListItem,
  transitionId: string,
  form: TransitionFormInput,
  view?: WorkflowTransition,
): boolean {
  const doc = documentOfTask(task);
  const transition = doc.transitions.find((t) => t.id === transitionId);
  if (!transition) return false;
  applyForm(task, form);
  if (view) postBlock(task, view, form);
  if (Object.keys(blockedByOf(task, doc, transitionId)).length > 0) return false;
  task.stage = resolveTarget(task, transition);
  if (transition.form?.enabled) {
    addTaskLocks(task.id, transition.form.locks ?? [], {
      lockedAt: new Date().toISOString(),
      lockedBy: currentAuthUser.id,
      source: { kind: 'transition', transitionId: transition.id, name: transition.name },
    });
  }
  task.updatedAt = new Date().toISOString();
  autoMovePersonalPlacement(task, demoPersonalStages);
  return true;
}

/** Коллективная кнопка (#434): сдача/отзыв отметки; после кворума — переход
 *  по обычному маршруту задачи, без отдельного статуса или workflow. */
export const tasksPressHandlers = [
  http.post('/api/v1/tasks/:id/press/submit', async ({ params, request }) => {
    const taskId = String(params.id);
    const current = pressOf(taskId, currentAuthUser.id);
    if (!current) return notFound();
    if (!current.canSubmit) return noRights();
    const task = findTask(taskId);
    const doc = task ? documentOfTask(task) : null;
    const transition = doc?.transitions.find((t) => t.id === current.transitionId);
    if (!task || !transition) return notFound();
    const parsed = pressSubmitBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 400 },
      );
    }
    // Окно участника — разделы настройки кнопки (#496) плюс разделы гейтов;
    // сами гейты проверяются при кворуме, а не на каждом нажатии.
    const sections = effectiveWindowSections(
      transition.form.enabled ? transition.form : null,
      { validators: transition.rules.validators },
    );
    const check = checkWindow(sections, parsed.data);
    if (check.missing.length > 0 || check.unexpected.length > 0) {
      return HttpResponse.json(
        {
          code: ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
          message: ui.tasks.transitionNeedsWindow,
          details: { transitionId: transition.id, ...check },
        },
        { status: 422 },
      );
    }
    const lockedWrite = windowLockDenial(task, sections, parsed.data);
    if (lockedWrite) return lockedWrite;
    const view = transitionsOf(task).find((t) => t.id === transition.id);
    const press = submitPress(taskId, currentAuthUser.id, parsed.data);
    if (press?.completed) {
      applyCollectiveTransition(task, press.transitionId, parsed.data, view);
    }
    return HttpResponse.json({
      press: press?.completed ? null : press,
      task: taskDetailOf(task),
      transitions: transitionsOf(task),
    });
  }),

  http.post('/api/v1/tasks/:id/press/withdraw', ({ params }) => {
    const taskId = String(params.id);
    const current = pressOf(taskId, currentAuthUser.id);
    if (!current) return notFound();
    if (!current.canWithdraw) return noRights();
    const press = withdrawPress(taskId, currentAuthUser.id);
    const task = findTask(taskId);
    if (!task) return notFound();
    return HttpResponse.json({
      press,
      task: taskDetailOf(task),
      transitions: transitionsOf(task),
    });
  }),
];
