import { z } from 'zod';
import type {
  Paginated,
  TaskDetail,
  TaskHistoryItem,
  TaskListItem,
  TaskStageWithCount,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import {
  asArray,
  asRecord,
  asTyped,
  pageItems,
  clip,
  date,
  dateTime,
  entityLink,
  finalize,
  hasMore,
  isOverdue,
  listBlock,
  nameOf,
  str,
} from '../projections.js';
import { tasksMeta } from './meta/tasks.meta.js';

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

/**
 * Строка списка задач: всё, чтобы модель могла ответить и позвать tasks.get.
 * Тип — контракт `TaskListItem` (#918): переименование поля в DTO ломает
 * компиляцию, а не тихо отдаёт «—» (ADR-0049).
 */
function taskRow(task: TaskListItem): string | null {
  if (!task.id || !task.title) return null;
  const stage = task.stage;
  const parts = [
    `№${task.number ?? '—'} «${task.title}»`,
    `стадия «${stage?.name ?? '—'}»${stage?.outcome ? ' (завершена)' : ''}`,
    task.deadline
      ? `срок ${date(task.deadline)}${isOverdue(task.deadline) && !stage?.outcome ? ' — ПРОСРОЧЕНО' : ''}`
      : 'без срока',
    `исполнитель ${task.assignee?.displayName ?? 'не назначен'}`,
  ];
  if (task.project) parts.push(`проект «${task.project.name ?? '—'}»`);
  if (task.type) parts.push(`тип «${task.type.name ?? '—'}»`);
  parts.push(`id ${task.id}`);
  return parts.join(', ');
}

/** Строки пагинированного ответа: мусор отбрасывается, типы — контракта. */
function taskRows(data: Paginated<TaskListItem>): string[] {
  return pageItems<TaskListItem>(data)
    .map((raw) => asTyped<TaskListItem>(raw))
    .flatMap((task) => {
      const row = task ? taskRow(task) : null;
      return row ? [row] : [];
    });
}

export const tasksListTool = defineTool({
  ...tasksMeta['tasks.list'],
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
    'в работе',
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
  project: (data: Paginated<TaskListItem>) => {
    // Список — не одна сущность: ссылку «Открыть» даёт только карточка
    // (tasks.get), иначе из 20 строк открывалась бы произвольная первая.
    return { text: finalize(listBlock('Задачи', taskRows(data), { more: hasMore(data) })) };
  },
});

const getInput = z.object({ id: z.uuid() });

export const tasksGetTool = defineTool({
  ...tasksMeta['tasks.get'],
  id: 'tasks.get',
  title: 'Задачи: карточка',
  description:
    'Карточка задачи по id: описание, стадия, срок, исполнитель, участники, трудозатраты, чек-лист, связи. Нужен id из tasks.list или tasks.search.',
  keywords: ['задача', 'карточка', 'детали', 'описание', 'трудозатраты', 'что там по задаче'],
  module: 'tasks',
  kind: 'read',
  featureFlag: 'tasks',
  hot: true,
  input: getInput,
  api: { method: 'GET', path: '/tasks/:id' },
  build: (input) => ({ path: `/tasks/${input.id}` }),
  project: (data: TaskDetail) => {
    const task = asTyped<TaskDetail>(data);
    if (!task || !task.id || !task.title) return { text: 'Задача не найдена или недоступна' };
    const stage = task.stage;
    const checklist = asArray(task.checklist).filter(
      (item) => typeof item === 'object' && item !== null,
    );
    const done = checklist.filter((item) => Boolean(asRecord(item)?.done)).length;
    const lines = [
      `№${task.number ?? '—'} «${task.title}» (id ${task.id})`,
      `Стадия: «${stage?.name ?? '—'}»${stage?.outcome ? ' — завершена' : ''}`,
      `Срок: ${task.deadline ? `${date(task.deadline)}${isOverdue(task.deadline) && !stage?.outcome ? ' (просрочено)' : ''}` : 'не задан'}`,
      `Исполнитель: ${task.assignee?.displayName ?? 'не назначен'}`,
      `Постановщик: ${task.creator?.displayName ?? '—'}`,
      `Участники: ${
        asArray(task.participants)
          .map((raw) => nameOf(asRecord(raw)))
          .filter(Boolean)
          .join(', ') || 'нет'
      }`,
      `Трудозатраты: ${task.spentMinutes ?? 0} мин${task.plannedMinutes ? ` из ${task.plannedMinutes} план` : ''}`,
      checklist.length > 0 ? `Чек-лист: ${done} из ${checklist.length}` : 'Чек-лист: нет',
      `Создана: ${dateTime(task.createdAt) ?? '—'}`,
      task.description ? `Описание: ${clip(task.description, 600)}` : 'Описание: пусто',
    ];
    return {
      text: finalize(lines.join('\n')),
      entity: entityLink('task', task.id, `№${task.number ?? ''} ${task.title}`.trim()),
    };
  },
});

const searchInput = z.object({
  query: z.string().trim().min(1).max(128),
  scope: z.enum(['mine', 'all']).default('mine'),
  limit: z.number().int().min(1).max(20).default(20),
});

export const tasksSearchTool = defineTool({
  ...tasksMeta['tasks.search'],
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
  project: (data: Paginated<TaskListItem>) => {
    return {
      text: finalize(listBlock('Найденные задачи', taskRows(data), { more: hasMore(data) })),
    };
  },
});

const stagesInput = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  typeId: z.uuid().optional(),
});

export const tasksStagesTool = defineTool({
  ...tasksMeta['tasks.stages'],
  id: 'tasks.stages',
  title: 'Задачи: стадии',
  description:
    'Стадии задач со счётчиками: сколько задач и сколько просрочено в каждой. Отдаёт id стадии — он нужен для смены статуса (tasks.update, stageId). Отвечает на «что горит», «где застряли задачи».',
  keywords: ['стадии', 'колонки', 'канбан', 'счётчики', 'застряло', 'stages', 'статус'],
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
  project: (data: TaskStageWithCount[]) => {
    const rows = asArray(data).map((raw) => {
      const stage = asTyped<TaskStageWithCount>(raw);
      if (!stage) return null;
      // id стадии — аргумент tasks.update (stageId): без него модель видит
      // только названия и не может сменить статус (живой отзыв 18.11.2026).
      const labels = [
        stage.typeName ? `тип «${stage.typeName}»` : null,
        stage.id ? `id ${stage.id}` : null,
      ].filter(Boolean);
      const suffix = labels.length > 0 ? ` (${labels.join(', ')})` : '';
      return `«${stage.name}»${suffix}: ${stage.count} задач${stage.overdueCount ? `, просрочено ${stage.overdueCount}` : ''}`;
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
  ...tasksMeta['tasks.history'],
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
  project: (data: Paginated<TaskHistoryItem>) => {
    const rows = pageItems<TaskHistoryItem>(data).map((raw) => {
      const entry = asTyped<TaskHistoryItem>(raw);
      if (!entry) return null;
      const when = dateTime(entry.createdAt) ?? '—';
      const who = nameOf(entry.actor) ?? 'система';
      // `summary`/`text`/`action` — алиасы старых записей истории; контракт
      // TaskHistoryItem отдаёт `type` (+ payload). Цепочка приоритетов та же.
      const legacy = asRecord(entry);
      const text =
        str(legacy?.summary) ??
        str(legacy?.text) ??
        str(legacy?.action) ??
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
