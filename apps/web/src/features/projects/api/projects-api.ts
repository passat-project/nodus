import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ListResult,
  Paginated,
  ProjectDetail,
  ProjectHistoryEntry,
  ProjectListItem,
  ProjectMember,
  ProjectSecretPreview,
  TaskListItem,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { applyServerTask } from '../../../shared/api/task-cache.js';
import { invalidateAfterTaskMutation } from '../../../shared/api/task-invalidate.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import {
  applyExtParams,
  hasListExtParams,
  type ListExtParams,
} from '../../../shared/views/list-ext/list-ext-query.js';
import {
  projectJournalParams,
  projectJournalUrl,
  type ProjectJournalFilters,
} from '../lib/project-journal.js';

export {
  projectsKeys,
  useProjectGroups,
  useProjectTypes,
  useProjectsList,
} from '../../../shared/api/projects-list.js';

/** Журнал проектов: серверные фильтры + keyset-курсор (Р14 #52). Кэш —
 *  InfiniteData страниц; оптимистичные мутации патчат его по префиксу
 *  `projects/journal`. */
export function useProjectsJournal(filters: ProjectJournalFilters) {
  const params = projectJournalParams(filters);
  return useInfiniteQuery({
    queryKey: projectsKeys.journal(params),
    queryFn: ({ pageParam }) =>
      api<Paginated<ProjectListItem>>(projectJournalUrl(params, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Карточка проекта (деталь: поля, атрибуты, права). */
export function useProjectDetail(id: string) {
  return useQuery({
    queryKey: projectsKeys.detail(id),
    queryFn: () => api<ProjectDetail>(`/projects/${id}`),
    // Смена проекта в стеке слайдеров: прежний контент остаётся, пока
    // грузится новый — панель не мигает скелетоном (I4).
    placeholderData: keepPreviousData,
    enabled: id.length > 0,
  });
}

/** История проекта (вкладка «История»): outbox-события агрегата, новые
 *  первыми, keyset-курсор. */
export function useProjectHistory(id: string) {
  return useInfiniteQuery({
    queryKey: projectsKeys.history(id),
    queryFn: ({ pageParam }) =>
      api<Paginated<ProjectHistoryEntry>>(
        `/projects/${id}/history?limit=30${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: id.length > 0,
  });
}

/** URL фида задач проекта: `scope=all` — дерево и список показывают ВСЕ
 *  задачи проекта, а не только «мои» (F-A, #467). Видимость проекта уже
 *  проверена сервером; для секретного проекта срез тот же. */
export function projectTaskFeedUrl(projectId: string, cursor: string | null, search = ''): string {
  const query = search.trim();
  return `/tasks?projectId=${projectId}&scope=all&limit=100${
    query ? `&search=${encodeURIComponent(query)}` : ''
  }${cursor ? `&cursor=${cursor}` : ''}`;
}

/** URL колонки проектного канбана — тот же `scope=all` (F-A). */
export function projectKanbanFeedUrl(
  projectId: string,
  stageId: string,
  cursor: string | null,
  limit: number,
  search = '',
): string {
  const query = search.trim();
  return `/tasks?stageId=${stageId}&projectId=${projectId}&scope=all&limit=${limit}${
    query ? `&search=${encodeURIComponent(query)}` : ''
  }${cursor ? `&cursor=${cursor}` : ''}`;
}

/** Задачи проекта (вид «Список»): те же сущности, фильтр projectId
 *  (плейбук §3.1 — один канбан и один список задач, а не два). Серверный
 *  поиск (#956) — своя ветка кэша под префиксом журнала. #435: ext
 *  (фильтр-предикаты/сортировка/группировка/итоги) — сервер считает по всей
 *  выборке проекта, ответ — ListResult. */
export function useProjectTaskPages(projectId: string, search?: string, ext?: ListExtParams) {
  const query = search?.trim() ?? '';
  const extActive = ext !== undefined && hasListExtParams(ext);
  const extKey = extActive ? JSON.stringify(ext) : undefined;
  return useInfiniteQuery({
    queryKey: [
      ...tasksKeys.listPages({
        projectId,
        scope: 'all',
        ...(query ? { search: query } : {}),
      }),
      ...(extKey ? [{ ext: extKey }] : []),
    ],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set('scope', 'all');
      params.set('limit', '100');
      if (query) params.set('search', query);
      if (pageParam) params.set('cursor', pageParam);
      if (extActive) applyExtParams(params, ext!);
      return api<ListResult<TaskListItem>>(`/tasks?projectId=${projectId}&${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: projectId.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** Перенос задачи проектной доски по глобальной оси (ADR-0008): борд —
 *  локальное состояние колонки (оптимистично, I4), сервер — PATCH /tasks/:id;
 *  откат снапшотом и тост — в обработчиках компонента доски. Ответ сервера
 *  пишется в журнал и оверлей досок; перезапрос — точечный (#1051): колонки
 *  открытой доски перезапрашивает сама доска в момент ответа (замок
 *  переносов), прежде инвалидировалось всё дерево ключей `tasks`. */
export function useMoveProjectTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, stageId, index }: { taskId: string; stageId: string; index: number }) =>
      api<TaskListItem>(`/tasks/${taskId}`, { method: 'PATCH', body: { stageId, index } }),
    // Летящий рефеч журнала или детали затёр бы оптимистичный перенос.
    onMutate: async ({ taskId }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: tasksKeys.listPages() }),
        queryClient.cancelQueries({ queryKey: tasksKeys.detail(taskId) }),
      ]);
    },
    onSuccess: (server) => applyServerTask(queryClient, server),
    onError: () => {
      toast.error(ui.tasks.stageMoveError);
    },
    // Стадия задачи кормит агрегаты узлов структуры (прогресс, крайние сроки).
    onSettled: (_data, _error, vars) =>
      invalidateAfterTaskMutation(queryClient, vars.taskId, { structure: true }),
  });
}

/** Превью перевода в секретный (#541): кто останется участником, кто
 *  потеряет доступ. Считается по задачам проекта на сервере. */
export function useProjectSecretPreview(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['projects', 'secret-preview', id] as const,
    queryFn: () => api<ProjectSecretPreview>(`/projects/${id}/secret-preview`),
    enabled: enabled && id.length > 0,
    staleTime: 0,
  });
}

/** Вкладка «Участники»: строки-источники, курсорная пагинация. */
export function useProjectMembers(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: projectsKeys.members(id),
    queryFn: ({ pageParam }) =>
      api<Paginated<ProjectMember>>(
        `/projects/${id}/members?limit=100${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: enabled && id.length > 0,
  });
}
