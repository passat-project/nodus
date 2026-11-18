import { z } from 'zod';
import {
  Permission,
  createSubtaskBodySchema,
  executeActionBodySchema,
  taskResultCreateBodySchema,
  timeEntryCreateBodySchema,
  type ExecuteTransitionResult,
  type TaskListItem,
  type TaskResult,
  type TimeEntry,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asRecord, asTyped, clip, date, str } from '../projections.js';
import {
  field,
  fieldsOf,
  formValues,
  humanDate,
  shortId,
  taskLabel,
  userName,
} from './write-cards.js';
import { tasksPartsMeta } from './meta/tasks-parts.meta.js';
import { actionName } from './tasks-parts.tools.js';

/**
 * Дневные действия по задаче (#928): итог, подзадача, трудозатраты и нажатие
 * кнопки маршрута. Все — через карточку подтверждения (ADR-0048), права
 * проверяет API.
 */

export const tasksAddResultTool = defineTool({
  ...tasksPartsMeta['tasks.add_result'],
  id: 'tasks.add_result',
  title: 'Задачи: записать итог',
  description:
    'Записать итог задачи (новую ревизию результата), при желании с закреплёнными сообщениями чата. Действие появится карточкой подтверждения.',
  keywords: ['итог задачи', 'результат', 'записать итог', 'result'],
  module: 'tasks',
  kind: 'write',
  featureFlag: 'tasks',
  hot: false,
  input: taskResultCreateBodySchema.extend({ taskId: z.uuid() }),
  api: { method: 'POST', path: '/tasks/:id/results' },
  build: (input) => ({
    method: 'POST',
    path: `/tasks/${input.taskId}/results`,
    body: {
      text: input.text,
      ...(input.messageIds ? { messageIds: input.messageIds } : {}),
    },
  }),
  project: (data: TaskResult, input) => {
    const result = asTyped<TaskResult>(data);
    const text = clip(str(result?.text) ?? input.text, 300);
    return {
      text: `Итог сохранён: «${text}»`,
      entity: { href: `?cards=task:${input.taskId}`, label: 'Задача' },
    };
  },
  card: {
    title: 'Записать итог задачи',
    summary: async (input, ctx) =>
      `Итог для задачи ${(await taskLabel(ctx, input.taskId)) ?? shortId(input.taskId)}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Задача', await taskLabel(ctx, input.taskId)),
        field('Итог', clip(input.text, 400)),
        field(
          'Сообщения',
          input.messageIds && input.messageIds.length > 0
            ? `закреплено сообщений: ${input.messageIds.length}`
            : null,
        ),
      ]),
    consequences:
      'Итог станет текущим результатом задачи; предыдущие ревизии остаются в истории. Автоматической отмены нет.',
  },
});

export const tasksAddSubtaskTool = defineTool({
  ...tasksPartsMeta['tasks.add_subtask'],
  id: 'tasks.add_subtask',
  title: 'Задачи: создать подзадачу',
  description:
    'Создать подзадачу в задаче: название обязательно; исполнитель, срок и узел структуры — по желанию. Действие появится карточкой подтверждения; право task.create проверяет портал.',
  keywords: ['подзадача', 'создать подзадачу', 'декомпозиция', 'subtask'],
  module: 'tasks',
  kind: 'write',
  permission: Permission.TASK_CREATE,
  featureFlag: 'tasks',
  hot: false,
  input: createSubtaskBodySchema.extend({ taskId: z.uuid() }),
  api: { method: 'POST', path: '/tasks/:id/subtasks' },
  build: (input) => ({
    method: 'POST',
    path: `/tasks/${input.taskId}/subtasks`,
    body: {
      title: input.title,
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
      ...(input.deadline ? { deadline: input.deadline } : {}),
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    },
  }),
  project: (data: TaskListItem) => {
    const task = asTyped<TaskListItem>(data);
    const id = str(task?.id);
    const title = str(task?.title) ?? 'Подзадача';
    return id
      ? {
          text: `Подзадача создана: №${task?.number ?? '—'} «${title}», id ${id}`,
          entity: { href: `?cards=task:${id}`, label: title },
        }
      : { text: `Подзадача создана: «${title}»` };
  },
  card: {
    title: 'Создать подзадачу',
    summary: async (input, ctx) => {
      const [parent, assignee] = await Promise.all([
        taskLabel(ctx, input.taskId),
        input.assigneeId ? userName(ctx, input.assigneeId) : null,
      ]);
      return `«${input.title}»${assignee ? ` → ${assignee}` : ''} в задаче ${parent ?? shortId(input.taskId)}`;
    },
    fields: async (input, ctx) =>
      fieldsOf([
        field('Родительская задача', await taskLabel(ctx, input.taskId)),
        field('Название', input.title),
        field('Исполнитель', input.assigneeId ? await userName(ctx, input.assigneeId) : null),
        field('Срок', humanDate(input.deadline)),
      ]),
    consequences:
      'Подзадача появится в дереве задачи. Созданную подзадачу можно удалить кнопкой «Отменить».',
    undo: (_input, output) => {
      const id = str(asRecord(output)?.id);
      return id ? { method: 'DELETE', path: `/tasks/${id}` } : null;
    },
  },
});

export const tasksLogTimeTool = defineTool({
  ...tasksPartsMeta['tasks.log_time'],
  id: 'tasks.log_time',
  title: 'Задачи: записать трудозатраты',
  description:
    'Записать отработанное время по задаче: минуты, дата работы и комментарий. Действие появится карточкой подтверждения; права проверяет API.',
  keywords: ['трудозатраты', 'залогировать время', 'часы', 'минуты', 'log time'],
  module: 'tasks',
  kind: 'write',
  featureFlag: 'tasks',
  hot: false,
  input: timeEntryCreateBodySchema.extend({ taskId: z.uuid() }),
  api: { method: 'POST', path: '/tasks/:id/time-entries' },
  build: (input) => ({
    method: 'POST',
    path: `/tasks/${input.taskId}/time-entries`,
    body: {
      minutes: input.minutes,
      date: input.date,
      ...(input.comment ? { comment: input.comment } : {}),
    },
  }),
  project: (data: TimeEntry, input) => {
    const entry = asTyped<TimeEntry>(data);
    return {
      text: `Трудозатраты записаны: ${duration(entry?.minutes ?? input.minutes)} за ${date(entry?.date ?? input.date) ?? input.date}`,
      entity: { href: `?cards=task:${input.taskId}`, label: 'Задача' },
    };
  },
  card: {
    title: 'Записать трудозатраты',
    summary: async (input, ctx) =>
      `${duration(input.minutes)} за ${date(input.date) ?? input.date} → ${(await taskLabel(ctx, input.taskId)) ?? shortId(input.taskId)}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Задача', await taskLabel(ctx, input.taskId)),
        field('Время', duration(input.minutes)),
        field('Дата работы', date(input.date) ?? input.date),
        field('Комментарий', input.comment ? clip(input.comment, 300) : null),
      ]),
    consequences: 'Запись появится в трудозатратах задачи; её можно удалить кнопкой «Отменить».',
    undo: (_input, output) => {
      const id = str(asRecord(output)?.id);
      return id ? { method: 'DELETE', path: `/tasks/time-entries/${id}` } : null;
    },
  },
});

const pressInput = z.object({
  taskId: z.uuid(),
  actionId: z.uuid(),
  ...executeActionBodySchema.shape,
});

export const tasksPressActionTool = defineTool({
  ...tasksPartsMeta['tasks.press_action'],
  id: 'tasks.press_action',
  title: 'Задачи: нажать действие маршрута',
  description:
    'Нажать кнопку действия маршрута задачи (без смены статуса): id действия из tasks.actions, при необходимости — поля окна. Действие появится карточкой подтверждения.',
  keywords: ['нажать действие', 'кнопка маршрута', 'согласовать', 'press action'],
  module: 'tasks',
  kind: 'write',
  featureFlag: 'tasks',
  hot: false,
  input: pressInput,
  api: { method: 'POST', path: '/tasks/:id/actions/:actionId/press' },
  build: (input) => ({
    method: 'POST',
    path: `/tasks/${input.taskId}/actions/${input.actionId}/press`,
    body: {
      ...(input.override !== undefined ? { override: input.override } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.form ? { form: input.form } : {}),
    },
  }),
  project: (data: ExecuteTransitionResult, input) => {
    const result = asTyped<ExecuteTransitionResult>(data);
    const task = result?.task;
    const id = str(task?.id) ?? input.taskId;
    const label = task?.title ?? 'Задача';
    return {
      text: `Действие выполнено${task ? `: №${task.number} «${label}»` : ''}; статус не изменился.`,
      entity: { href: `?cards=task:${id}`, label },
    };
  },
  card: {
    title: 'Нажать действие маршрута',
    summary: async (input, ctx) => {
      const [task, name] = await Promise.all([
        taskLabel(ctx, input.taskId),
        actionName(ctx, input.taskId, input.actionId),
      ]);
      return `«${name ?? shortId(input.actionId)}» → ${task ?? shortId(input.taskId)}`;
    },
    fields: async (input, ctx) =>
      fieldsOf([
        field('Задача', await taskLabel(ctx, input.taskId)),
        field('Действие', await actionName(ctx, input.taskId, input.actionId)),
        field('Окно', formValues(input.form)),
        field('Причина обхода', input.reason),
      ]),
    consequences:
      'Действие запишет изменения в журнал задачи, но не сменит статус. Автоматической отмены нет.',
  },
});

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

export const tasksTimeResultTools = [
  tasksAddResultTool,
  tasksAddSubtaskTool,
  tasksLogTimeTool,
  tasksPressActionTool,
];
