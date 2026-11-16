import { z } from 'zod';

import { defineTool } from '../tool-definition.js';
import {
  asArray,
  asRecord,
  clip,
  date,
  dateTime,
  entityLink,
  finalize,
  hasMore,
  isOverdue,
  itemsOf,
  listBlock,
  nameOf,
  num,
  str,
} from '../projections.js';

/**
 * Инструменты задач (#892): журнал, карточка, поиск, стадии, история.
 * Только чтение: каждая операция — существующий GET-маршрут модуля tasks,
 * исполняется от имени сотрудника (его права и фильтр видимости).
 */

const listInput = z.object({
  /** `mine` — мои задачи, `all` — все видимые (нужно право/участие). */
  scope: z.enum(['mine', 'all']).default('mine'),
  role: z.enum(['assignee', 'creator', 'coexecutor', 'observer', 'decider']).optional(),
  overdue: z.boolean().optional(),
  /** Подстрока по номеру и названию. */
  search: z.string().trim().min(1).max(128).optional(),
  stageId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

/** Строка списка задач: всё, чтобы модель могла ответить и позвать tasks.get. */
function taskRow(raw: unknown): string | null {
  const task = asRecord(raw);
  if (!task) return null;
  const id = str(task.id);
  const title = str(task.title);
  if (!id || !title) return null;
  const stage = asRecord(task.stage);
  const parts = [
    `№${num(task.number) ?? '—'} «${title}»`,
    `стадия «${str(stage?.name) ?? '—'}»${stage?.outcome ? ' (завершена)' : ''}`,
    task.deadline
      ? `срок ${date(task.deadline)}${isOverdue(task.deadline) && !stage?.outcome ? ' — ПРОСРОЧЕНО' : ''}`
      : 'без срока',
    `исполнитель ${nameOf(task.assignee) ?? 'не назначен'}`,
  ];
  const project = asRecord(task.project);
  if (project) parts.push(`проект «${nameOf(project) ?? '—'}»`);
  const type = asRecord(task.type);
  if (type) parts.push(`тип «${nameOf(type) ?? '—'}»`);
  parts.push(`id ${id}`);
  return parts.join(', ');
}

export const tasksListTool = defineTool({
  id: 'tasks.list',
  title: 'Задачи: список',
  description:
    'Список видимых задач с фильтрами: мои/все, просроченные, по стадии, проекту, исполнителю, поиск по названию. Отдаёт номер, название, стадию, срок, исполнителя и id для tasks.get.',
  keywords: [
    'задачи',
    'задача',
    'поручения',
    'журнал',
    'просрочено',
    'дедлайн',
    'мои задачи',
    'tasks',
  ],
  module: 'tasks',
  kind: 'read',
  featureFlag: 'tasks',
  hot: true,
  input: listInput,
  api: { method: 'GET', path: '/tasks' },
  build: (input) => ({
    path: '/tasks',
    query: {
      view: 'list',
      scope: input.scope,
      limit: String(input.limit),
      ...(input.role ? { role: input.role } : {}),
      ...(input.overdue !== undefined ? { overdue: String(input.overdue) } : {}),
      ...(input.search ? { search: input.search } : {}),
      ...(input.stageId ? { stageId: input.stageId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    },
  }),
  project: (data) => {
    const rows = itemsOf(data)
      .map(taskRow)
      .filter((row): row is string => row !== null);
    const first = asRecord(itemsOf(data)[0]);
    return {
      text: finalize(listBlock('Задачи', rows, { more: hasMore(data) })),
      ...(first && str(first.id) && str(first.title)
        ? {
            entity: entityLink(
              'task',
              str(first.id)!,
              `№${num(first.number) ?? ''} ${str(first.title)}`,
            ),
          }
        : {}),
    };
  },
});

const getInput = z.object({ id: z.uuid() });

export const tasksGetTool = defineTool({
  id: 'tasks.get',
  title: 'Задачи: карточка',
  description:
    'Карточка задачи по id: описание, стадия, срок, исполнитель, участники, трудозатраты, чек-лист, связи. Нужен id из tasks.list или tasks.search.',
  keywords: ['задача', 'карточка', 'детали', 'описание', 'трудозатраты'],
  module: 'tasks',
  kind: 'read',
  featureFlag: 'tasks',
  hot: true,
  input: getInput,
  api: { method: 'GET', path: '/tasks/:id' },
  build: (input) => ({ path: `/tasks/${input.id}` }),
  project: (data) => {
    const task = asRecord(data);
    const id = str(task?.id);
    const title = str(task?.title);
    if (!task || !id || !title) return { text: 'Задача не найдена или недоступна' };
    const stage = asRecord(task.stage);
    const checklist = asArray(task.checklist);
    const done = checklist.filter((item) => Boolean(asRecord(item)?.done)).length;
    const lines = [
      `№${num(task.number) ?? '—'} «${title}» (id ${id})`,
      `Стадия: «${str(stage?.name) ?? '—'}»${stage?.outcome ? ' — завершена' : ''}`,
      `Срок: ${task.deadline ? `${date(task.deadline)}${isOverdue(task.deadline) && !stage?.outcome ? ' (просрочено)' : ''}` : 'не задан'}`,
      `Исполнитель: ${nameOf(task.assignee) ?? 'не назначен'}`,
      `Постановщик: ${nameOf(task.creator) ?? '—'}`,
      `Участники: ${asArray(task.participants).map(nameOf).filter(Boolean).join(', ') || 'нет'}`,
      `Трудозатраты: ${num(task.spentMinutes) ?? 0} мин${task.plannedMinutes ? ` из ${num(task.plannedMinutes)} план` : ''}`,
      checklist.length > 0 ? `Чек-лист: ${done} из ${checklist.length}` : 'Чек-лист: нет',
      `Создана: ${dateTime(task.createdAt) ?? '—'}`,
      str(task.description) ? `Описание: ${clip(str(task.description)!, 600)}` : 'Описание: пусто',
    ];
    return {
      text: finalize(lines.join('\n')),
      entity: entityLink('task', id, `№${num(task.number) ?? ''} ${title}`.trim()),
    };
  },
});

const searchInput = z.object({
  query: z.string().trim().min(1).max(128),
  scope: z.enum(['mine', 'all']).default('mine'),
  limit: z.number().int().min(1).max(20).default(20),
});

export const tasksSearchTool = defineTool({
  id: 'tasks.search',
  title: 'Задачи: поиск',
  description:
    'Поиск задач по подстроке в номере и названии. Используй, когда сотрудник называет тему или номер задачи, но точного id нет.',
  keywords: ['найти', 'поиск', 'задача', 'номер', 'тема', 'search'],
  module: 'tasks',
  kind: 'read',
  featureFlag: 'tasks',
  hot: true,
  input: searchInput,
  api: { method: 'GET', path: '/tasks' },
  build: (input) => ({
    path: '/tasks',
    query: { view: 'list', scope: input.scope, search: input.query, limit: String(input.limit) },
  }),
  project: (data) => {
    const rows = itemsOf(data)
      .map(taskRow)
      .filter((row): row is string => row !== null);
    return { text: finalize(listBlock('Найденные задачи', rows, { more: hasMore(data) })) };
  },
});

const stagesInput = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  typeId: z.uuid().optional(),
});

export const tasksStagesTool = defineTool({
  id: 'tasks.stages',
  title: 'Задачи: стадии',
  description:
    'Стадии задач со счётчиками: сколько задач и сколько просрочено в каждой. Отвечает на «что горит», «где застряли задачи».',
  keywords: ['стадии', 'колонки', 'канбан', 'счётчики', 'застряло', 'stages'],
  module: 'tasks',
  kind: 'read',
  featureFlag: 'tasks',
  hot: false,
  input: stagesInput,
  api: { method: 'GET', path: '/tasks/stages' },
  build: (input) => ({
    path: '/tasks/stages',
    query: { scope: input.scope, ...(input.typeId ? { typeId: input.typeId } : {}) },
  }),
  project: (data) => {
    const rows = asArray(data).map((raw) => {
      const stage = asRecord(raw);
      if (!stage) return null;
      const name = str(stage.name) ?? '—';
      return `«${name}»: ${num(stage.count) ?? 0} задач${num(stage.overdueCount) ? `, просрочено ${num(stage.overdueCount)}` : ''}`;
    });
    return {
      text: finalize(
        listBlock(
          'Стадии задач',
          rows.filter((row): row is string => row !== null),
          { maxRows: 30 },
        ),
      ),
    };
  },
});

const historyInput = z.object({
  id: z.uuid(),
  limit: z.number().int().min(1).max(30).default(20),
});

export const tasksHistoryTool = defineTool({
  id: 'tasks.history',
  title: 'Задачи: история',
  description:
    'История задачи по id: переходы стадий, смены исполнителя и сроков, комментарии системы с датами и авторами.',
  keywords: ['история', 'журнал', 'переходы', 'кто менял', 'хронология', 'history'],
  module: 'tasks',
  kind: 'read',
  featureFlag: 'tasks',
  hot: false,
  input: historyInput,
  api: { method: 'GET', path: '/tasks/:id/history' },
  build: (input) => ({ path: `/tasks/${input.id}/history`, query: { limit: String(input.limit) } }),
  project: (data) => {
    const rows = itemsOf(data).map((raw) => {
      const entry = asRecord(raw);
      if (!entry) return null;
      const when = dateTime(entry.createdAt) ?? '—';
      const who = nameOf(entry.actor) ?? 'система';
      const text =
        str(entry.summary) ??
        str(entry.text) ??
        str(entry.action) ??
        str(entry.type) ??
        'изменение';
      return `${when} — ${who}: ${clip(text, 200)}`;
    });
    return {
      text: finalize(
        listBlock(
          'История задачи',
          rows.filter((row): row is string => row !== null),
          { maxRows: 30, more: hasMore(data) },
        ),
      ),
    };
  },
});

export const tasksTools = [
  tasksListTool,
  tasksGetTool,
  tasksSearchTool,
  tasksStagesTool,
  tasksHistoryTool,
];
