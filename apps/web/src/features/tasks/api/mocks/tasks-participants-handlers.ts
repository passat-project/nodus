import { ErrorCode, participantLockKey, taskParticipantAddBodySchema } from '@nodus/contracts';

import { http, HttpResponse } from 'msw';

import { demoTasks, detailsExtra, taskDetailOf } from '../../../../shared/mocks/data/tasks.js';
import { userRef } from '../../../../shared/mocks/data/users.js';
import { lockDenial } from '../../../../shared/mocks/data/task-locks.js';
import { requiredKeysOf, typeOfTask } from './task-create-policy.js';

function notFound(message: string) {
  return HttpResponse.json({ code: ErrorCode.NOT_FOUND, message }, { status: 404 });
}

/** Участники (#252/#311): соисполнитель — в `participants`, наблюдатель —
 *  в `observers` детали; повторное добавление меняет роль. */
export const tasksParticipantsHandlers = [
  http.post('/api/v1/tasks/:id/participants', async ({ params, request }) => {
    const task = demoTasks.find((t) => t.id === params.id);
    if (!task) return notFound('Task not found');
    const parsed = taskParticipantAddBodySchema.safeParse(await request.json());
    if (!parsed.success || parsed.data.userId === task.assignee?.id)
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 400 },
      );
    const extra = (detailsExtra[task.id] ??= {
      description: taskDetailOf(task).description,
      observers: [],
      checklist: [],
      createdAt: task.updatedAt,
    });
    const { userId, role } = parsed.data;
    // Закреплённые участники (#496, Р4): 422 FIELD_LOCKED или правка с причиной.
    const locked = lockDenial(task, [participantLockKey(role)], parsed.data.lockReason);
    if (locked) return locked;
    task.participants = task.participants.filter((p) => p.id !== userId);
    extra.observers = extra.observers.filter((p) => p.id !== userId);
    if (role === 'coexecutor') task.participants.push(userRef(userId));
    else extra.observers.push(userRef(userId));
    return HttpResponse.json(taskDetailOf(task), { status: 201 });
  }),

  http.delete('/api/v1/tasks/:id/participants/:userId', ({ params, request }) => {
    const task = demoTasks.find((t) => t.id === params.id);
    if (!task) return notFound('Task not found');
    const userId = String(params.userId);
    const extra = detailsExtra[task.id];
    // Причина правки закреплённых участников — `?lockReason=` (#496, Р4).
    const lockReason = new URL(request.url).searchParams.get('lockReason') ?? undefined;
    const role = task.participants.some((p) => p.id === userId) ? 'coexecutor' : 'observer';
    const locked = lockDenial(task, [participantLockKey(role)], lockReason);
    if (locked) return locked;
    // Снятие последнего обязательного участника — 422 `reason: 'clear'` (#432, Р5).
    const type = typeOfTask(task.type.id);
    const required = requiredKeysOf(type);
    const isCoexecutor = task.participants.some((p) => p.id === userId);
    const lastCoexecutor = isCoexecutor && task.participants.length === 1;
    const lastObserver = !isCoexecutor && (extra?.observers.length ?? 0) === 1;
    if (
      (lastCoexecutor && required.includes('coexecutors')) ||
      (lastObserver && required.includes('observers'))
    ) {
      return HttpResponse.json(
        {
          code: ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
          message: ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
          details: {
            typeId: task.type.id,
            fields: [lastCoexecutor ? 'coexecutors' : 'observers'],
            reason: 'clear',
          },
        },
        { status: 422 },
      );
    }
    task.participants = task.participants.filter((p) => p.id !== userId);
    if (extra) extra.observers = extra.observers.filter((p) => p.id !== userId);
    return HttpResponse.json(taskDetailOf(task));
  }),
];
