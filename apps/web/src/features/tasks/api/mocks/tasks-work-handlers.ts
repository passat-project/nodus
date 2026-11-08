import type {
  LockablePatch,
  LockableValues,
  RunningTimer,
  TaskListItem,
  TaskResult,
  TimeEntry,
} from '@nodus/contracts';
import {
  changedLockKeys,
  ErrorCode,
  taskBulkBodySchema,
  taskResultCreateBodySchema,
  timeEntryCreateBodySchema,
} from '@nodus/contracts';

import { http, HttpResponse } from 'msw';

import {
  demoSubtasks,
  demoTasks,
  detailsExtra,
  taskDetailOf,
} from '../../../../shared/mocks/data/tasks.js';
import { findDemoNodeRow } from '../../../../shared/mocks/data/project-nodes.js';
import { demoStages } from '../../../../shared/mocks/data/task-stages.js';
import { currentAuthUser, userRef } from '../../../../shared/mocks/data/users.js';
import { lockDenial } from '../../../../shared/mocks/data/task-locks.js';

/** Работа по задаче в демо-режиме (#311): типы, учёт времени и таймер,
 *  результат, массовые операции. Права не моделируются — демо-пользователь
 *  может всё (их проверяет бэкенд #37). */

/** Патч массовой операции для карты замков (#496, Р4): смена стадии полей не
 *  трогает, остальные действия — те же ключи, что у PATCH. */
function bulkPatch(action: {
  kind: string;
  deadline?: string | null;
  priority?: string;
  assigneeId?: string;
  nodeId?: string | null;
}): LockablePatch {
  switch (action.kind) {
    case 'set_deadline':
      return { deadline: action.deadline };
    case 'set_priority':
      return { priority: action.priority };
    case 'set_assignee':
      return { assigneeId: action.assigneeId };
    case 'set_node':
      return { nodeId: action.nodeId };
    default:
      return {};
  }
}

/** Значения записи для сравнения (как у сервера: только фактическая правка). */
function lockableValues(task: TaskListItem): LockableValues {
  const detail = taskDetailOf(task);
  return {
    title: task.title,
    description: detail.description,
    deadline: task.deadline,
    priority: task.priority,
    plannedMinutes: detail.plannedMinutes,
    assigneeId: task.assignee?.id ?? null,
    projectId: task.project?.id ?? null,
    nodeId: task.nodeId ?? null,
    customFields: task.customFields,
  };
}

function findTask(id: unknown): TaskListItem | undefined {
  return (
    demoTasks.find((t) => t.id === id) ??
    Object.values(demoSubtasks)
      .flat()
      .find((t) => t.id === id)
  );
}

const invalid = () =>
  HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 422 },
  );
const notFound = () =>
  HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Task not found' }, { status: 404 });

const timeEntries: TimeEntry[] = [];
let running: { entryId: string; taskId: string; startedAt: string } | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function stopRunning(): void {
  if (!running) return;
  const task = findTask(running.taskId);
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(running.startedAt)) / 60_000));
  timeEntries.unshift({
    id: running.entryId,
    taskId: running.taskId,
    user: userRef(currentAuthUser.id),
    minutes,
    date: today(),
    method: 'timer',
    startedAt: running.startedAt,
    endedAt: new Date().toISOString(),
    comment: null,
    createdAt: new Date().toISOString(),
  });
  if (task) task.spentMinutes += minutes;
  running = null;
}

function timerDto(): RunningTimer | null {
  const task = running ? findTask(running.taskId) : undefined;
  if (!running || !task) return null;
  return {
    entryId: running.entryId,
    task: { id: task.id, number: task.number, title: task.title },
    startedAt: running.startedAt,
  };
}

export const tasksWorkHandlers = [
  // GET /workflows/types переехал в automation-handlers (#378): расширенный DTO
  // с icon/color/creatable/архивом; MSW матчит по порядку — дубль здесь
  // перехватывал запрос и ронял UI старой формой.

  http.get('/api/v1/tasks/timer', () => HttpResponse.json(timerDto())),

  http.post('/api/v1/tasks/timer/stop', () => {
    if (!running)
      return HttpResponse.json(
        { code: ErrorCode.TASK_TIMER_NOT_RUNNING, message: 'Timer is not running' },
        { status: 409 },
      );
    stopRunning();
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete('/api/v1/tasks/time-entries/:entryId', ({ params }) => {
    const index = timeEntries.findIndex((e) => e.id === params.entryId);
    const entry = timeEntries[index];
    if (!entry) return notFound();
    timeEntries.splice(index, 1);
    const task = entry.taskId ? findTask(entry.taskId) : undefined;
    if (task) task.spentMinutes = Math.max(0, task.spentMinutes - entry.minutes);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/tasks/:id/time-entries', ({ params }) =>
    HttpResponse.json({
      items: timeEntries.filter((e) => e.taskId === params.id),
      nextCursor: null,
    }),
  ),

  http.post('/api/v1/tasks/:id/time-entries', async ({ params, request }) => {
    const task = findTask(params.id);
    if (!task) return notFound();
    const parsed = timeEntryCreateBodySchema.safeParse(await request.json());
    if (!parsed.success) return invalid();
    const entry: TimeEntry = {
      id: crypto.randomUUID(),
      taskId: task.id,
      user: userRef(currentAuthUser.id),
      minutes: parsed.data.minutes,
      date: parsed.data.date,
      method: 'manual',
      startedAt: null,
      endedAt: null,
      comment: parsed.data.comment ?? null,
      createdAt: new Date().toISOString(),
    };
    timeEntries.unshift(entry);
    task.spentMinutes += entry.minutes;
    return HttpResponse.json(entry, { status: 201 });
  }),

  http.post('/api/v1/tasks/:id/timer/start', ({ params }) => {
    const task = findTask(params.id);
    if (!task) return notFound();
    stopRunning();
    running = {
      entryId: crypto.randomUUID(),
      taskId: task.id,
      startedAt: new Date().toISOString(),
    };
    return HttpResponse.json(timerDto());
  }),

  http.post('/api/v1/tasks/:id/results', async ({ params, request }) => {
    const task = findTask(params.id);
    if (!task) return notFound();
    const parsed = taskResultCreateBodySchema.safeParse(await request.json());
    if (!parsed.success) return invalid();
    const result: TaskResult = {
      id: crypto.randomUUID(),
      text: parsed.data.text,
      messageIds: parsed.data.messageIds ?? [],
      author: userRef(currentAuthUser.id),
      createdAt: new Date().toISOString(),
    };
    const extra = (detailsExtra[task.id] ??= {
      description: taskDetailOf(task).description,
      observers: [],
      checklist: [],
      createdAt: task.updatedAt,
    });
    extra.result = result;
    return HttpResponse.json(result, { status: 201 });
  }),

  http.delete('/api/v1/tasks/:id', ({ params }) => {
    const index = demoTasks.findIndex((t) => t.id === params.id);
    const task = demoTasks[index];
    if (!task) return notFound();
    demoTasks.splice(index, 1);
    // Подзадачи поднимаются к деду (как на сервере #37).
    for (const t of demoTasks) if (t.parentId === task.id) t.parentId = task.parentId;
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/tasks/bulk', async ({ request }) => {
    const parsed = taskBulkBodySchema.safeParse(await request.json());
    if (!parsed.success) return invalid();
    const { action } = parsed.data;
    const results = parsed.data.taskIds.map((taskId) => {
      const task = findTask(taskId);
      if (!task) return { taskId, ok: false, code: ErrorCode.NOT_FOUND };
      // Замок записи (#496, Р4): массовая правка не обходит закреплённое —
      // ответ по задаче, как у серверного bulk (причины в bulk не бывает).
      const locked = changedLockKeys(lockableValues(task), bulkPatch(action));
      if (lockDenial(task, locked, undefined)) {
        return { taskId, ok: false, code: ErrorCode.FIELD_LOCKED };
      }
      if (action.kind === 'set_deadline') task.deadline = action.deadline;
      if (action.kind === 'set_priority') task.priority = action.priority;
      if (action.kind === 'set_assignee') task.assignee = userRef(action.assigneeId);
      if (action.kind === 'move_to_stage') {
        const stage = demoStages.find((s) => s.id === action.stageId);
        if (!stage) return { taskId, ok: false, code: ErrorCode.NOT_FOUND };
        task.stage = stage;
      }
      // Перенос в узел структуры (#467): null — «Без узла»; узел обязан
      // существовать и принадлежать проекту задачи.
      if (action.kind === 'set_node') {
        if (action.nodeId === null) {
          task.nodeId = null;
        } else {
          const node = findDemoNodeRow(action.nodeId);
          if (!node || node.projectId !== task.project?.id) {
            return { taskId, ok: false, code: ErrorCode.PROJECT_NODE_INVALID };
          }
          task.nodeId = node.id;
        }
      }
      task.updatedAt = new Date().toISOString();
      return { taskId, ok: true };
    });
    return HttpResponse.json({ results });
  }),
];
