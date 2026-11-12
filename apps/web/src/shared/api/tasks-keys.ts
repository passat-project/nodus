import type { InfiniteData } from '@tanstack/react-query';
import type { Paginated, TaskListItem } from '@nodus/contracts';

import { projectsKeys } from './projects-list.js';
import { taskStagesKey } from './task-stages.js';

/** Ключи кэша задач — CANONICAL в shared (потребители: фича задач и
 *  общие компоненты создания `shared/tasks`; фича реэкспортирует из
 *  `api/tasks-api.ts` для обратной совместимости). Строки ключей руками
 *  не пишутся (patterns.md) — только эта фабрика. */
export const tasksKeys = {
  all: ['tasks'] as const,
  /** Журнал задач — бесконечные страницы (useTasksPages, useProjectTaskPages). */
  listPages: (params?: { projectId?: string; scope?: 'all'; role?: 'decider' }) =>
    params
      ? ([...tasksKeys.all, 'list-pages', params] as const)
      : ([...tasksKeys.all, 'list-pages'] as const),
  /** Доски-канбаны (первые страницы колонок): scope — 'personal' | 'project:<id>'. */
  kanban: (scope: string) => [...tasksKeys.all, 'kanban', scope] as const,
  /** Префикс всех досок — инвалидация мутациями (перенос по степперу, CRUD стадий). */
  kanbanAll: () => [...tasksKeys.all, 'kanban'] as const,
  /** Общий каталог стадий — ключ из shared (потребители: задачи, проекты). */
  stages: () => taskStagesKey,
  personalStages: () => [...tasksKeys.all, 'personal-stages'] as const,
  /** Серверный поиск задач (палитра Ctrl+K). */
  search: (q: string) => [...tasksKeys.all, 'search', q] as const,
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
  /** Каталог типов задач (ступень 1 — один системный «Задача»). */
  /** Записи времени задачи (I14). */
  timeEntries: (id: string) => [...tasksKeys.all, 'time-entries', id] as const,
  /** Идущий таймер текущего пользователя (один на сотрудника). */
  timer: () => [...tasksKeys.all, 'timer'] as const,
};

/** Всё, что зависит от полей/состояния задачи: деталь, переходы (гейты
 *  DoR/DoD читают поля), доски, журнал, счётчики каталогов и агрегаты узлов
 *  структуры проекта (#467: прогресс/часы/сроки узла считаются из задач). */
export function taskDependentKeys(taskId: string) {
  return [
    tasksKeys.detail(taskId),
    tasksKeys.transitions(taskId),
    tasksKeys.actions(taskId),
    tasksKeys.listPages(),
    tasksKeys.kanbanAll(),
    tasksKeys.personalStages(),
    tasksKeys.stages(),
    tasksKeys.branchAll(),
    projectsKeys.structures(),
  ];
}

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
