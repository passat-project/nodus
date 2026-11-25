import type { InfiniteData } from '@tanstack/react-query';
import type { Paginated, TaskListItem } from '@nodus/contracts';

import { taskStagesKey } from './task-stages.js';

/** Ключи кэша задач — CANONICAL в shared (потребители: фича задач и
 *  общие компоненты создания `shared/tasks`; фича реэкспортирует из
 *  `api/tasks-api.ts` для обратной совместимости). Строки ключей руками
 *  не пишутся (patterns.md) — только эта фабрика. */
export const tasksKeys = {
  all: ['tasks'] as const,
  /** Журнал задач — бесконечные страницы (useTasksPages, useProjectTaskPages).
   *  `search` (#956) — серверный поиск: своя ветка кэша под общим префиксом,
   *  чтобы инвалидации журнала доставали и её. */
  listPages: (params?: {
    projectId?: string;
    assigneeId?: string;
    scope?: 'all';
    role?: 'decider';
    search?: string;
  }) =>
    params
      ? ([...tasksKeys.all, 'list-pages', params] as const)
      : ([...tasksKeys.all, 'list-pages'] as const),
  /** Доски-канбаны (первые страницы колонок): scope — 'personal' | 'project:<id>';
   *  `search` (#956) — серверный поиск по колонкам. */
  kanban: (scope: string, search?: string) =>
    search
      ? ([...tasksKeys.all, 'kanban', scope, { search }] as const)
      : ([...tasksKeys.all, 'kanban', scope] as const),
  /** Префикс всех досок — инвалидация мутациями (перенос по степперу, CRUD стадий). */
  kanbanAll: () => [...tasksKeys.all, 'kanban'] as const,
  /** Общий каталог стадий — ключ из shared (потребители: задачи, проекты). */
  stages: () => taskStagesKey,
  personalStages: () => [...tasksKeys.all, 'personal-stages'] as const,
  /** Серверный поиск задач (палитра Ctrl+K). */
  search: (q: string) => [...tasksKeys.all, 'search', q] as const,
  /** Контекст ИИ-ассистента (первая страница журнала): ВЫДЕЛЕННЫЙ ключ —
   *  форма Paginated не должна пересекаться с InfiniteData журнала. */
  assistantContext: () => [...tasksKeys.all, 'assistant-context'] as const,
  detail: (id: string) => [...tasksKeys.all, 'detail', id] as const,
  /** Префикс всех деталей — каталожные события полей (#431). */
  detailsAll: () => [...tasksKeys.all, 'detail'] as const,
  branch: (id: string) => [...tasksKeys.all, 'branch', id] as const,
  /** Префикс всех веток навигатора — инвалидация (структура дерева меняется). */
  branchAll: () => [...tasksKeys.all, 'branch'] as const,
  relations: (id: string) => [...tasksKeys.all, 'relations', id] as const,
  /** Доступные переходы маршрута задачи (кнопки бара, ADR-0020). */
  transitions: (id: string) => [...tasksKeys.all, 'transitions', id] as const,
  /** Доступные действия без смены статуса (#633). */
  actions: (id: string) => [...tasksKeys.all, 'actions', id] as const,
  /** Журнал задачи (вкладка «История», I9): события task.* курсором. */
  history: (id: string) => [...tasksKeys.all, 'history', id] as const,
  /** Каталог типов задач (ступень 1 — один системный «Задача»). */
  /** Записи времени задачи (I14). */
  timeEntries: (id: string) => [...tasksKeys.all, 'time-entries', id] as const,
  /** Идущий таймер текущего пользователя (один на сотрудника). */
  timer: () => [...tasksKeys.all, 'timer'] as const,
};

/** Точечное обновление задачи в бесконечном кэше журнала (оптимистичные
 *  мутации переноса, I4): задача встречается на одной из подгруженных страниц. */
export function mapTaskInPages(
  data: InfiniteData<Paginated<TaskListItem>> | undefined,
  taskId: string,
  patch: (t: TaskListItem) => TaskListItem,
): InfiniteData<Paginated<TaskListItem>> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      items: p.items.map((t) => (t.id === taskId ? patch(t) : t)),
    })),
  };
}
