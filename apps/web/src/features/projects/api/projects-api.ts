import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
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
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
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
export function projectTaskFeedUrl(projectId: string, cursor: string | null): string {
  return `/tasks?projectId=${projectId}&scope=all&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
}

/** URL колонки проектного канбана — тот же `scope=all` (F-A). */
export function projectKanbanFeedUrl(
  projectId: string,
  stageId: string,
  cursor: string | null,
  limit: number,
): string {
  return `/tasks?stageId=${stageId}&projectId=${projectId}&scope=all&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
}

/** Задачи проекта (вид «Список»): те же сущности, фильтр projectId
 *  (плейбук §3.1 — один канбан и один список задач, а не два). */
export function useProjectTaskPages(projectId: string) {
  return useInfiniteQuery({
    queryKey: tasksKeys.listPages({ projectId, scope: 'all' }),
    queryFn: ({ pageParam }) =>
      api<Paginated<TaskListItem>>(projectTaskFeedUrl(projectId, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: projectId.length > 0,
  });
}

/** Перенос задачи проектной доски по глобальной оси (ADR-0008): борд —
 *  локальное состояние колонки (оптимистично, I4), сервер — PATCH /tasks/:id;
 *  откат снапшотом и тост — в обработчиках компонента доски. */
export function useMoveProjectTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, stageId, index }: { taskId: string; stageId: string; index: number }) =>
      api<TaskListItem>(`/tasks/${taskId}`, { method: 'PATCH', body: { stageId, index } }),
    onError: () => {
      toast.error(ui.tasks.stageMoveError);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
    },
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
