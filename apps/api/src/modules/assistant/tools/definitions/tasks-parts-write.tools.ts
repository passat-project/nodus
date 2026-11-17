import { z } from 'zod';
import {
  taskParticipantAddBodySchema,
  taskRelationCreateBodySchema,
  type ChecklistItem,
  type Paginated,
  type TaskDetail,
  type TaskRelation,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asArray, asRecord, asTyped, pageItems, str } from '../projections.js';
import { field, fieldsOf, shortId, taskLabel, userName } from './write-cards.js';
import { tasksPartsMeta } from './meta/tasks-parts.meta.js';
import { RELATION_LABEL } from './tasks-parts.tools.js';

/**
 * Дневные действия по задаче (#928): чек-лист, участники, связи. Запись —
 * только карточкой подтверждения (ADR-0048); карточка называет задачу,
 * сотрудника и связь человеческими именами.
 */

const ROLE_LABEL: Record<string, string> = {
  coexecutor: 'соисполнитель',
  observer: 'наблюдатель',
};

export const tasksChecklistAddTool = defineTool({
  ...tasksPartsMeta['tasks.checklist_add'],
  id: 'tasks.checklist_add',
  title: 'Задачи: добавить пункт чек-листа',
  description:
    'Добавить пункт в чек-лист задачи. Действие появится карточкой подтверждения; права на задачу проверяет API.',
  keywords: ['чек-лист', 'добавить пункт', 'пункт чек-листа', 'checklist'],
  module: 'tasks',
  kind: 'write',
  featureFlag: 'tasks',
  hot: false,
  input: z.object({ taskId: z.uuid(), text: z.string().trim().min(1).max(300) }),
  api: { method: 'POST', path: '/tasks/:id/checklist' },
  build: (input) => ({
    method: 'POST',
    path: `/tasks/${input.taskId}/checklist`,
    body: { text: input.text },
  }),
  project: (data: ChecklistItem, input) => {
    const item = asTyped<ChecklistItem>(data);
    const text = str(item?.text) ?? input.text;
    return {
      text: `Пункт чек-листа добавлен: «${text}»`,
      entity: { href: `?cards=task:${input.taskId}`, label: 'Задача' },
    };
  },
  card: {
    title: 'Добавить пункт чек-листа',
    summary: async (input, ctx) => {
      const task = await taskLabel(ctx, input.taskId);
      return `Пункт «${input.text}» → задача ${task ?? shortId(input.taskId)}`;
    },
    fields: async (input, ctx) =>
      fieldsOf([field('Задача', await taskLabel(ctx, input.taskId)), field('Пункт', input.text)]),
    consequences: 'Пункт появится в чек-листе задачи; создание можно отменить кнопкой «Отменить».',
    undo: (input, output) => {
      const id = str(asRecord(output)?.id);
      return id ? { method: 'DELETE', path: `/tasks/${input.taskId}/checklist/${id}` } : null;
    },
  },
});

const checklistUpdateInput = z
  .object({
    taskId: z.uuid(),
    itemId: z.uuid(),
    done: z.boolean().optional(),
    text: z.string().trim().min(1).max(300).optional(),
    index: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'taskId' && key !== 'itemId'), {
    message: 'Нужно хотя бы одно изменение: done, text или index',
  });

export const tasksChecklistUpdateTool = defineTool({
  ...tasksPartsMeta['tasks.checklist_update'],
  id: 'tasks.checklist_update',
  title: 'Задачи: отметить пункт чек-листа',
  description:
    'Отметить пункт чек-листа выполненным/снять отметку, изменить текст или позицию. Действие появится карточкой подтверждения; права проверяет API.',
  keywords: ['отметить пункт', 'выполнено', 'чек-лист', 'снять отметку', 'checklist update'],
  module: 'tasks',
  kind: 'write',
  featureFlag: 'tasks',
  hot: false,
  input: checklistUpdateInput,
  api: { method: 'PATCH', path: '/tasks/:id/checklist/:itemId' },
  build: (input) => ({
    method: 'PATCH',
    path: `/tasks/${input.taskId}/checklist/${input.itemId}`,
    body: {
      ...(input.done !== undefined ? { done: input.done } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.index !== undefined ? { index: input.index } : {}),
    },
  }),
  project: (data: ChecklistItem, input) => {
    const item = asTyped<ChecklistItem>(data);
    const text = str(item?.text) ?? input.text ?? 'пункт';
    return {
      text: `Пункт чек-листа ${item?.done ? 'выполнен' : 'обновлён'}: «${text}»`,
      entity: { href: `?cards=task:${input.taskId}`, label: 'Задача' },
    };
  },
  card: {
    title: 'Отметить пункт чек-листа',
    summary: async (input, ctx) => {
      const [task, item] = await Promise.all([
        taskLabel(ctx, input.taskId),
        checklistItem(ctx, input.taskId, input.itemId),
      ]);
      const action =
        input.done === true ? 'выполнить' : input.done === false ? 'снять отметку' : 'изменить';
      return `${action}: «${item?.text ?? shortId(input.itemId)}» в задаче ${task ?? shortId(input.taskId)}`;
    },
    fields: async (input, ctx) => {
      const item = await checklistItem(ctx, input.taskId, input.itemId);
      return fieldsOf([
        field('Задача', await taskLabel(ctx, input.taskId)),
        field('Пункт', item?.text ?? input.itemId),
        field(
          'Состояние',
          input.done === true ? 'выполнен' : input.done === false ? 'не выполнен' : null,
        ),
        field('Новый текст', input.text),
        field('Позиция', input.index !== undefined ? String(input.index + 1) : null),
      ]);
    },
    consequences:
      'Отметка сохранится в чек-листе; автоматической отмены нет — вернуть прежнее состояние можно вручную.',
  },
});

export const tasksAddParticipantTool = defineTool({
  ...tasksPartsMeta['tasks.add_participant'],
  id: 'tasks.add_participant',
  title: 'Задачи: добавить участника',
  description:
    'Добавить соисполнителя или наблюдателя в задачу (или сменить роль). Действие появится карточкой подтверждения; права на задачу проверяет API.',
  keywords: [
    'соисполнитель',
    'наблюдатель',
    'добавить участника',
    'назначить соисполнителя',
    'назначить соисполнителем',
  ],
  module: 'tasks',
  kind: 'write',
  featureFlag: 'tasks',
  hot: false,
  input: taskParticipantAddBodySchema.extend({ taskId: z.uuid() }),
  api: { method: 'POST', path: '/tasks/:id/participants' },
  build: (input) => ({
    method: 'POST',
    path: `/tasks/${input.taskId}/participants`,
    body: {
      userId: input.userId,
      role: input.role,
      ...(input.lockReason ? { lockReason: input.lockReason } : {}),
    },
  }),
  project: (data: TaskDetail, input) => {
    const task = asTyped<TaskDetail>(data);
    const id = str(task?.id) ?? input.taskId;
    return {
      text: `Участник добавлен (${ROLE_LABEL[input.role] ?? input.role})`,
      entity: { href: `?cards=task:${id}`, label: str(task?.title) ?? 'Задача' },
    };
  },
  card: {
    title: 'Добавить участника задачи',
    summary: async (input, ctx) => {
      const [task, user] = await Promise.all([
        taskLabel(ctx, input.taskId),
        userName(ctx, input.userId),
      ]);
      return `${user ?? 'Сотрудник'} → ${ROLE_LABEL[input.role] ?? input.role} задачи ${task ?? shortId(input.taskId)}`;
    },
    fields: async (input, ctx) =>
      fieldsOf([
        field('Задача', await taskLabel(ctx, input.taskId)),
        field('Сотрудник', await userName(ctx, input.userId)),
        field('Роль', ROLE_LABEL[input.role] ?? input.role),
        field('Причина', input.lockReason),
      ]),
    consequences:
      'Сотрудник получит доступ к задаче по роли. Добавление можно отменить кнопкой «Отменить».',
    undo: (input) => ({
      method: 'DELETE',
      path: `/tasks/${input.taskId}/participants/${input.userId}`,
    }),
  },
});

export const tasksAddRelationTool = defineTool({
  ...tasksPartsMeta['tasks.add_relation'],
  id: 'tasks.add_relation',
  title: 'Задачи: связать задачи',
  description:
    'Связать задачу с другой: связана, блокирует, предшествует, дублирует. Действие появится карточкой подтверждения; видимость обеих задач проверяет API.',
  keywords: ['связать задачи', 'связь', 'блокирует', 'зависимость', 'add relation'],
  module: 'tasks',
  kind: 'write',
  featureFlag: 'tasks',
  hot: false,
  input: taskRelationCreateBodySchema.extend({ taskId: z.uuid() }),
  api: { method: 'POST', path: '/tasks/:id/relations' },
  build: (input) => ({
    method: 'POST',
    path: `/tasks/${input.taskId}/relations`,
    body: { toTaskId: input.toTaskId, kind: input.kind },
  }),
  project: (data: Paginated<TaskRelation>, input) => {
    const relation = pageItems<TaskRelation>(data).find(
      (item) => item.task.id === input.toTaskId && item.kind === input.kind,
    );
    const label = relation?.task
      ? `№${relation.task.number} «${relation.task.title}»`
      : shortId(input.toTaskId);
    return {
      text: `Связь «${RELATION_LABEL[input.kind] ?? input.kind}» с задачей ${label} добавлена`,
      entity: { href: `?cards=task:${input.taskId}`, label: 'Задача' },
    };
  },
  card: {
    title: 'Связать задачи',
    summary: async (input, ctx) => {
      const [task, target] = await Promise.all([
        taskLabel(ctx, input.taskId),
        taskLabel(ctx, input.toTaskId),
      ]);
      return `${task ?? shortId(input.taskId)} ${RELATION_LABEL[input.kind] ?? input.kind} ${target ?? shortId(input.toTaskId)}`;
    },
    fields: async (input, ctx) =>
      fieldsOf([
        field('Задача', await taskLabel(ctx, input.taskId)),
        field('Связь', RELATION_LABEL[input.kind] ?? input.kind),
        field('Связанная задача', await taskLabel(ctx, input.toTaskId)),
      ]),
    consequences:
      'Связь появится у обеих задач; её можно убрать кнопкой «Отменить» (удаление связи, не задач).',
    undo: (input, output) => {
      const relation = pageItems<TaskRelation>(output as Paginated<TaskRelation>).find(
        (item) => item.task.id === input.toTaskId && item.kind === input.kind,
      );
      return relation
        ? { method: 'DELETE', path: `/tasks/${input.taskId}/relations/${relation.id}` }
        : null;
    },
  },
});

interface ChecklistInfo {
  text: string;
  done: boolean;
}

async function checklistItem(
  ctx: ToolContext,
  taskId: string,
  itemId: string,
): Promise<ChecklistInfo | null> {
  try {
    const task = asRecord(await ctx.read?.(`/tasks/${taskId}`));
    const found = asArray(task?.checklist)
      .map((item) => asRecord(item))
      .find((item) => str(item?.id) === itemId);
    const text = str(found?.text);
    return text ? { text, done: found?.done === true } : null;
  } catch {
    return null;
  }
}

export const tasksPartsWriteTools = [
  tasksChecklistAddTool,
  tasksChecklistUpdateTool,
  tasksAddParticipantTool,
  tasksAddRelationTool,
];
