import { useCallback, useRef } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  Paginated,
  TaskBranch,
  TaskDetail,
  TaskListItem,
  TaskRelation,
  TaskStage,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { buildTempSubtask } from '../lib/temp-records.js';

import { api } from '../../../shared/api-client.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { invalidateAfterTaskMutation } from '../../../shared/api/task-invalidate.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';

// Ключи кэша и помощник страниц — canonical в shared/api/tasks-keys (общие
// компоненты создания в shared/tasks тоже ими пользуются); реэкспорт для
// потребителей фичи.
export { mapTaskInPages, tasksKeys } from '../../../shared/api/tasks-keys.js';

/** Список (таблица с деревом): scope «мои» / «все доступные» (подчинённые
 *  по оргструктуре, task.view_all — сервер решает видимость); курсорные страницы по 100, подгрузка sentinel-ом
 * у dna контейнера (industry-паттерн: целиком на клиент крупные списки не
 * живут). Серверный поиск (#956): `search` ищет по названию/номеру во ВСЕЙ
 * выдаче, а не только по загруженным страницам. Дерево строится из
 * загруженного; родитель старше окна страницы отображается корнем
 * (известное ограничение до серверного lazy-дерева). */
export function useTasksPages(scope: 'mine' | 'all' = 'mine', role?: 'decider', search?: string) {
  const query = search?.trim() ?? '';
  return useInfiniteQuery({
    // «Мои» — канонический ключ (оптимистичные патчи бьют в него точно);
    // «Все доступные», «Ждут моего решения» и поиск — свои ключи под тем же
    // префиксом (инвалидации общие, страницы не смешиваются).
    queryKey: tasksKeys.listPages(
      role
        ? { scope: 'all', role, ...(query ? { search: query } : {}) }
        : scope === 'all' || query
          ? {
              ...(scope === 'all' ? { scope: 'all' as const } : {}),
              ...(query ? { search: query } : {}),
            }
          : undefined,
    ),
    queryFn: ({ pageParam }) =>
      api<Paginated<TaskListItem>>(
        `/tasks?view=list&scope=${role ? 'all' : scope}&limit=100${
          role ? `&role=${role}` : ''
        }${query ? `&search=${encodeURIComponent(query)}` : ''}${
          pageParam ? `&cursor=${pageParam}` : ''
        }`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** Ветка задачи для панели-навигатора: дерево от корневого предка. */
export function useTaskBranch(id: string) {
  return useQuery({
    queryKey: tasksKeys.branch(id),
    queryFn: () => api<TaskBranch>(`/tasks/${id}/branch`),
  });
}

/** Связи задачи (поле «Отношения», вкладка «Связи» навигатора) — заготовка
 *  под зависимости Ганта (#39); пока список пуст. */
export function useTaskRelations(id: string) {
  return useQuery({
    queryKey: tasksKeys.relations(id),
    queryFn: () => api<Paginated<TaskRelation>>(`/tasks/${id}/relations`),
  });
}

export function useTaskDetail(id: string) {
  return useQuery({
    queryKey: tasksKeys.detail(id),
    queryFn: () => api<TaskDetail>(`/tasks/${id}`),
    // Смена задачи в навигаторе ветки: прежний контент остаётся, пока грузится
    // новый — карточка не мигает скелетоном (плавность, I4).
    placeholderData: keepPreviousData,
  });
}

/** Свежесть префетча детали (A6-3, #632): без staleTime каждый pointerenter
 *  строки/карточки стоил GET — наведение на список из сотни строк гоняло
 *  сеть. 45 с переживают серию наведений и возврат к строке. */
const PREFETCH_STALE_MS = 45_000;
/** Leading-edge троттл по taskId: после инвалидации деталь снова stale, и
 *  без окна префетч шёл бы в сеть на каждое наведение. */
const PREFETCH_REPEAT_MS = 30_000;

/** Префетч детали по ховеру строки/карточки: первое открытие слайдера
 *  рендерит контент одним проходом (без скелетон-релэйаута) — первая
 *  анимация не платит холодный fetch. Беседу задачи по ховеру не трогаем:
 *  by-task — find-or-create, запись на наведение мыши недопустима. */
export function usePrefetchTask() {
  const queryClient = useQueryClient();
  // Карта «когда префетчили» — в ref: переживает ререндеры списка, но не
  // сессию (глобальный Map утёк бы между размонтированными видами).
  const prefetchedAt = useRef(new Map<string, number>());
  return useCallback(
    (taskId: string) => {
      const now = Date.now();
      const last = prefetchedAt.current.get(taskId);
      if (last !== undefined && now - last < PREFETCH_REPEAT_MS) return;
      prefetchedAt.current.set(taskId, now);
      void queryClient.prefetchQuery({
        queryKey: tasksKeys.detail(taskId),
        queryFn: () => api<TaskDetail>(`/tasks/${taskId}`),
        staleTime: PREFETCH_STALE_MS,
      });
    },
    [queryClient],
  );
}

/** Подзадача в один клик (I4): мгновенно в кэш детали, замена темповой на серверную. */
export function useAddSubtask(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (title: string) =>
      api<TaskListItem>(`/tasks/${taskId}/subtasks`, { method: 'POST', body: { title } }),

    onMutate: async (title) => {
      await queryClient.cancelQueries({ queryKey: tasksKeys.detail(taskId) });
      const previous = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
      if (!previous) return { previous: undefined, tempId: '' };
      // Явные поля темпа (не `...previous`): чужой номер/срок/стадия родителя
      // выдавали бы темп за копию родителя — buildTempSubtask.
      const temp = buildTempSubtask(
        previous,
        title,
        queryClient.getQueryData<TaskStage[]>(tasksKeys.stages()),
        useAuthStore.getState().user,
      );
      queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), {
        ...previous,
        subtasks: [...previous.subtasks, temp],
      });
      return { previous, tempId: temp.id };
    },

    onError: (_error, _title, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tasksKeys.detail(taskId), context.previous);
      }
      toast.error(ui.common.sendError);
    },

    onSuccess: (server, _title, context) => {
      if (!context?.tempId) return;
      const current = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
      if (!current) return;
      queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), {
        ...current,
        subtasks: current.subtasks.map((s) => (s.id === context.tempId ? server : s)),
      });
    },

    onSettled: () => {
      // Новая подзадача меняет гейт «нет открытых подзадач» и агрегаты узлов;
      // ветку, журнал и доски (подзадача — тоже задача «Моего плана») догоняет
      // эхо task.created (#1051).
      invalidateAfterTaskMutation(queryClient, taskId, { structure: true });
    },
  });
}

/** Подзадача произвольному родителю из навигатора ветки: без оптимистичного
 *  темпа в кэше детали (родитель может быть не открыт), дерево и деталь
 *  инвалидируются по завершении. */
export function useAddSubtaskTo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, title }: { parentId: string; title: string }) =>
      api<TaskListItem>(`/tasks/${parentId}/subtasks`, { method: 'POST', body: { title } }),
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.detail(vars.parentId) });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.branchAll() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.listPages() });
    },
  });
}
