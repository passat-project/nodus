import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Paginated, ProjectListItem, TaskListItem } from '@nodus/contracts';

import { api } from '../api-client.js';

/**
 * Связи карточки сотрудника (вкладки «Задачи»/«Проекты», I14 — анализ портала
 * от человека). Живут в shared/api: потребитель — features/directory, а I6
 * запрещает фичам импортировать друг друга (hooks задач/проектов — в своих
 * фичах); обе ветки — публичные list-ресурсы с query-фильтрами.
 */

/** Ключи без поиска — канонические (их читают бейджи вкладок); с поиском —
 *  отдельная ветка под тем же префиксом (#956). */
export const userRelationsKeys = {
  tasks: (userId: string, search?: string) =>
    search
      ? ([...['tasks', 'assignee', userId], { search }] as const)
      : (['tasks', 'assignee', userId] as const),
  projects: (userId: string, search?: string) =>
    search
      ? ([...['projects', 'member', userId], { search }] as const)
      : (['projects', 'member', userId] as const),
};

/** Задачи, где сотрудник — ответственный исполнитель (GET /tasks?assigneeId=).
 *  `scope=all` — все задачи сотрудника, видимые смотрящему по правилам
 *  видимости, а не только пересечение с его личным участием (#866, AUD-028).
 *  `search` (#956) — серверный поиск по названию/номеру во всей выдаче. */
export function assigneeTasksUrl(userId: string, search = ''): string {
  const query = search.trim();
  return `/tasks?assigneeId=${userId}&scope=all&limit=100${
    query ? `&search=${encodeURIComponent(query)}` : ''
  }`;
}

export function useAssigneeTasks(userId: string, search?: string) {
  const query = search?.trim() || undefined;
  return useQuery({
    queryKey: userRelationsKeys.tasks(userId, query),
    queryFn: () => api<Paginated<TaskListItem>>(assigneeTasksUrl(userId, query)),
    placeholderData: keepPreviousData,
  });
}

/** Проекты сотрудника — руководит или участник (GET /projects?memberId=).
 *  `scope=all` — тот же срез смотрящего, что у вкладки «Задачи» (#866, AUD-028). */
export function memberProjectsUrl(userId: string, search = ''): string {
  const query = search.trim();
  return `/projects?memberId=${userId}&scope=all&limit=100${
    query ? `&search=${encodeURIComponent(query)}` : ''
  }`;
}

export function useMemberProjects(
  userId: string,
  options: { enabled?: boolean; search?: string } = {},
) {
  const query = options.search?.trim() || undefined;
  return useQuery({
    queryKey: userRelationsKeys.projects(userId, query),
    queryFn: () => api<Paginated<ProjectListItem>>(memberProjectsUrl(userId, query)),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}
