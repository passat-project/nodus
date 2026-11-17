import { z } from 'zod';
import { Permission, taskPrioritySchema, type TaskListItem } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asArray, asRecord, asTyped, clip, nameOf, num, str } from '../projections.js';
import { field, fieldsOf, humanDate, projectName, shortId, userName } from './write-cards.js';

/**
 * Действия по задачам (Ф2, ADR-0048): создание и правка полей/стадии.
 * Инструмент НЕ пишет из цикла — он готовит карточку подтверждения; запись
 * выполняет сотрудник кнопкой «Выполнить» (или байпас) от своего имени:
 * права `task.create`, видимость проекта и гейты маршрута проверяет API.
 */

const PRIORITY_LABEL: Record<string, string> = {
  low: 'низкий',
  normal: 'обычный',
  high: 'высокий',
  urgent: 'срочный',
};

const createInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  projectId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  deadline: z.iso.datetime().optional(),
  typeId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  priority: taskPrioritySchema.optional(),
});

export const tasksCreateTool = defineTool({
  id: 'tasks.create',
  title: 'Задачи: создать',
  description:
    'Создать задачу: название обязательно; проект, исполнитель, срок, тип, стадия и приоритет — по желанию. Действие появится карточкой на подтверждение; после «Выполнить» задача создаётся от имени сотрудника.',
  keywords: [
    'создать задачу',
    'поставить задачу',
    'поручение',
    'новая задача',
    'назначить',
    'create task',
  ],
  module: 'tasks',
  kind: 'write',
  permission: Permission.TASK_CREATE,
  featureFlag: 'tasks',
  hot: true,
  input: createInput,
  api: { method: 'POST', path: '/tasks' },
  build: (input) => ({
    method: 'POST',
    path: '/tasks',
    body: {
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
      ...(input.deadline ? { deadline: input.deadline } : {}),
      ...(input.typeId ? { typeId: input.typeId } : {}),
      ...(input.stageId ? { stageId: input.stageId } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
    },
  }),
  project: (data: TaskListItem) => {
    const task = asTyped<TaskListItem>(data);
    if (!task?.id) return { text: 'Задача создана, но ответ портала не разобран' };
    return {
      text: `Задача создана: ${task.number ? `№${task.number} ` : ''}«${task.title ?? '—'}», id ${task.id}`,
      entity: {
        href: `?cards=task:${task.id}`,
        label: `${task.number ? `№${task.number} ` : ''}${task.title ?? ''}`.trim(),
      },
    };
  },
  card: {
    title: 'Создать задачу',
    summary: async (input, ctx) => {
      const project = input.projectId ? await projectName(ctx, input.projectId) : null;
      return `Задача «${input.title}»${project ? ` в проекте «${project}»` : ''}`;
    },
    fields: async (input, ctx) => {
      const [project, assignee] = await Promise.all([
        input.projectId ? projectName(ctx, input.projectId) : Promise.resolve(null),
        input.assigneeId ? userName(ctx, input.assigneeId) : Promise.resolve(null),
      ]);
      return fieldsOf([
        field('Название', input.title),
        field('Проект', project ?? input.projectId),
        field('Исполнитель', assignee ?? input.assigneeId),
        field('Срок', humanDate(input.deadline)),
        field('Приоритет', input.priority ? PRIORITY_LABEL[input.priority] : null),
        field('Описание', input.description ? clip(input.description, 400) : null),
      ]);
    },
    consequences:
      'Задача появится в портале и станет видна участникам и постановщику. Созданную задачу можно удалить кнопкой «Отменить».',
    undo: (_input, output) => {
      const id = str(asRecord(output)?.id);
      return id ? { method: 'DELETE', path: `/tasks/${id}` } : null;
    },
  },
});

const updateInput = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    deadline: z.iso.datetime().nullable().optional(),
    assigneeId: z.uuid().optional(),
    stageId: z.uuid().optional(),
    priority: taskPrioritySchema.optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), {
    message: 'Нужно хотя бы одно изменение кроме id',
  });

export const tasksUpdateTool = defineTool({
  id: 'tasks.update',
  title: 'Задачи: изменить',
  description:
    'Изменить задачу по id: название, описание, срок (null — убрать), исполнитель, стадия маршрута, приоритет. Действие появится карточкой на подтверждение; права и переходы стадий проверяет API портала.',
  keywords: [
    'изменить задачу',
    'сменить статус',
    'сменить стадию',
    'перенести задачу',
    'назначить исполнителя',
    'изменить срок',
    'update task',
  ],
  module: 'tasks',
  kind: 'write',
  featureFlag: 'tasks',
  hot: true,
  input: updateInput,
  api: { method: 'PATCH', path: '/tasks/:id' },
  build: (input) => ({
    method: 'PATCH',
    path: `/tasks/${input.id}`,
    body: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
      ...(input.stageId ? { stageId: input.stageId } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
    },
  }),
  project: (data: TaskListItem) => {
    const task = asTyped<TaskListItem>(data);
    if (!task?.id) return { text: 'Задача изменена' };
    return {
      text: `Задача обновлена: ${task.number ? `№${task.number} ` : ''}«${task.title ?? '—'}», id ${task.id}`,
      entity: {
        href: `?cards=task:${task.id}`,
        label: `${task.number ? `№${task.number} ` : ''}${task.title ?? ''}`.trim(),
      },
    };
  },
  card: {
    title: 'Изменить задачу',
    summary: async (input, ctx) => {
      const task = await readTask(ctx, input.id);
      const label = task
        ? `«${task.title}»${task.number ? ` (№${task.number})` : ''}`
        : `id ${shortId(input.id)}`;
      return `Изменения в задаче ${label}`;
    },
    fields: async (input, ctx) => {
      const [task, assignee, stage] = await Promise.all([
        readTask(ctx, input.id),
        input.assigneeId ? userName(ctx, input.assigneeId) : Promise.resolve(null),
        input.stageId ? stageName(ctx, input.stageId) : Promise.resolve(null),
      ]);
      return fieldsOf([
        field(
          'Задача',
          task ? `${task.number ? `№${task.number} ` : ''}«${task.title}»` : input.id,
        ),
        field('Новое название', input.title),
        field('Новый срок', input.deadline === null ? 'убрать срок' : humanDate(input.deadline)),
        field('Исполнитель', assignee ?? input.assigneeId),
        field('Стадия', stage ?? input.stageId),
        field('Приоритет', input.priority ? PRIORITY_LABEL[input.priority] : null),
        field('Описание', input.description ? clip(input.description, 400) : null),
      ]);
    },
    consequences:
      'Изменение применится к живой задаче и станет видно участникам; автоматической отмены нет — проверите поля перед выполнением.',
  },
});

/** Карточка-источник: реальные номер и название задачи (не слова модели). */
async function readTask(
  ctx: ToolContext,
  id: string,
): Promise<{ title: string; number: number | null } | null> {
  try {
    const raw = asRecord(await ctx.read?.(`/tasks/${id}`));
    const title = str(raw?.title);
    return title ? { title, number: num(raw?.number) } : null;
  } catch {
    return null;
  }
}

/** Название стадии из каталога стадий (id модели не показываем, если нашли). */
async function stageName(ctx: ToolContext, stageId: string): Promise<string | null> {
  try {
    for (const raw of asArray(await ctx.read?.('/tasks/stages?scope=all'))) {
      const stage = asRecord(raw);
      if (str(stage?.id) === stageId) return nameOf(stage) ?? str(stage?.name);
    }
  } catch {
    return null;
  }
  return null;
}

export const tasksWriteTools = [tasksCreateTool, tasksUpdateTool];
