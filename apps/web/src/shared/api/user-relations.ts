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

/** Предохранитель добора: 50 страниц × 100 = 5000 строк — на порядок выше
 *  реальных объёмов; сервер с «вечным» курсором не повесит вкладку. */
const RELATIONS_MAX_PAGES = 50;

/**
 * ВСЯ выдача постранично (limit=100, цикл по `nextCursor`, образец —
 * `users-list.ts`): карточка показывает все задачи/проекты сотрудника, а не
 * первые 100 (#913). Дубли по id отбрасываются, порядок сервера сохраняется;
 * `nextCursor` результата — всегда null. Ошибка любой страницы роняет запрос
 * целиком: обрезанный список не должен выглядеть полным.
 */
async function fetchAllPages<T extends { id: string }>(url: string): Promise<Paginated<T>> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < RELATIONS_MAX_PAGES; page += 1) {
    const pageUrl: string = cursor ? `${url}&cursor=${encodeURIComponent(cursor)}` : url;
    const result: Paginated<T> = await api<Paginated<T>>(pageUrl);
    for (const item of result.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return { items, nextCursor: null };
}

export function useAssigneeTasks(userId: string, search?: string) {
  const query = search?.trim() || undefined;
  return useQuery({
    queryKey: userRelationsKeys.tasks(userId, query),
    queryFn: () => fetchAllPages<TaskListItem>(assigneeTasksUrl(userId, query)),
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
    queryFn: () => fetchAllPages<ProjectListItem>(memberProjectsUrl(userId, query)),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}
