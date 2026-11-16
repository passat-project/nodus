import { useQuery } from '@tanstack/react-query';
import type { Paginated, ProjectListItem, TaskListItem } from '@nodus/contracts';

import { api } from '../api-client.js';

/**
 * Связи карточки сотрудника (вкладки «Задачи»/«Проекты», I14 — анализ портала
 * от человека). Живут в shared/api: потребитель — features/directory, а I6
 * запрещает фичам импортировать друг друга (hooks задач/проектов — в своих
 * фичах); обе ветки — публичные list-ресурсы с query-фильтрами.
 */

export const userRelationsKeys = {
  tasks: (userId: string) => ['tasks', 'assignee', userId] as const,
  projects: (userId: string) => ['projects', 'member', userId] as const,
};

/** Задачи, где сотрудник — ответственный исполнитель (GET /tasks?assigneeId=).
 *  `scope=all` — все задачи сотрудника, видимые смотрящему по правилам
 *  видимости, а не только пересечение с его личным участием (#866, AUD-028). */
export function assigneeTasksUrl(userId: string): string {
  return `/tasks?assigneeId=${userId}&scope=all&limit=100`;
}

export function useAssigneeTasks(userId: string) {
  return useQuery({
    queryKey: userRelationsKeys.tasks(userId),
    queryFn: () => api<Paginated<TaskListItem>>(assigneeTasksUrl(userId)),
  });
}

/** Проекты сотрудника — руководит или участник (GET /projects?memberId=).
 *  `scope=all` — тот же срез смотрящего, что у вкладки «Задачи» (#866, AUD-028). */
export function memberProjectsUrl(userId: string): string {
  return `/projects?memberId=${userId}&scope=all&limit=100`;
}

export function useMemberProjects(userId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: userRelationsKeys.projects(userId),
    queryFn: () => api<Paginated<ProjectListItem>>(memberProjectsUrl(userId)),
    enabled: options.enabled ?? true,
  });
}
