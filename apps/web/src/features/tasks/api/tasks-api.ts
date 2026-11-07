import { useCallback, useRef } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
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

import { transitionErrorText } from './transitions-api.js';
import { buildTempSubtask } from '../lib/temp-records.js';

import { api } from '../../../shared/api-client.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { mapTaskInPages, taskDependentKeys, tasksKeys } from '../../../shared/api/tasks-keys.js';

// Ключи кэша и помощник страниц — canonical в shared/api/tasks-keys (общие
// компоненты создания в shared/tasks тоже ими пользуются); реэкспорт для
// потребителей фичи.
export { mapTaskInPages, tasksKeys } from '../../../shared/api/tasks-keys.js';

/** Список (таблица с деревом): scope «мои» / «все доступные» (подчинённые
 *  по оргструктуре, task.view_all — сервер решает видимость); курсорные страницы по 100, подгрузка sentinel-ом
 * у dna контейнера (industry-паттерн: целиком на клиент крупные списки не
 * живут). Дерево строится из загруженного; родитель старше окна страницы
 * отображается корнем (известное ограничение до серверного lazy-дерева). */
export function useTasksPages(scope: 'mine' | 'all' = 'mine', role?: 'decider') {
  return useInfiniteQuery({
    // «Мои» — канонический ключ (оптимистичные патчи бьют в него точно);
    // «Все доступные» и «Ждут моего решения» — свои ключи под тем же
    // префиксом (инвалидации общие, страницы не смешиваются).
    queryKey: tasksKeys.listPages(
      role ? { scope: 'all', role } : scope === 'all' ? { scope } : undefined,
    ),
    queryFn: ({ pageParam }) =>
      api<Paginated<TaskListItem>>(
        `/tasks?view=list&scope=${role ? 'all' : scope}&limit=100${
          role ? `&role=${role}` : ''
        }${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
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

/** Оптимистичный перенос задачи между стадиями (канбан DnD, I4):
 * мутация в кэш до ответа сервера, откат по снапшоту при ошибке. */
export function useUpdateTaskStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, stageId, index }: { taskId: string; stageId: string; index: number }) =>
      api<TaskListItem>(`/tasks/${taskId}`, { method: 'PATCH', body: { stageId, index } }),

    onMutate: async ({ taskId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: tasksKeys.listPages() });
      const previous = queryClient.getQueryData<InfiniteData<Paginated<TaskListItem>>>(
        tasksKeys.listPages(),
      );
      const previousDetail = queryClient.getQueryData<TaskDetail>(tasksKeys.detail(taskId));
      const stage = queryClient
        .getQueryData<TaskStage[]>(tasksKeys.stages())
        ?.find((s) => s.id === stageId);
      queryClient.setQueryData<InfiniteData<Paginated<TaskListItem>>>(
        tasksKeys.listPages(),
        (old) =>
          stage
            ? mapTaskInPages(old, taskId, (t) => ({
                ...t,
                stage,
                updatedAt: new Date().toISOString(),
              }))
            : old,
      );
      queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), (old) =>
        old && stage ? { ...old, stage, updatedAt: new Date().toISOString() } : old,
      );
      return { previous, previousDetail };
    },

    onError: (error, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tasksKeys.listPages(), context.previous);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(tasksKeys.detail(vars.taskId), context.previousDetail);
      }
      // Отказ маршрута/гейта — с причиной (ADR-0020), не безликое «вернули».
      toast.error(transitionErrorText(error));
    },

    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.listPages() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.kanbanAll() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.detail(vars.taskId) });
    },
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

/** Поиск задач (палитра Ctrl+K): серверный фильтр по титулу/номеру —
 * industry-паттерн: клиент не держит весь список ради поиска. */
export function useTasksSearch(q: string) {
  return useQuery({
    queryKey: tasksKeys.search(q),
    queryFn: () => api<Paginated<TaskListItem>>(`/tasks?search=${encodeURIComponent(q)}&limit=20`),
    enabled: q.length > 0,
  });
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
      // Новая открытая подзадача меняет гейт «нет открытых подзадач», ветку,
      // журнал и доски (подзадача — тоже задача «Моего плана»).
      for (const key of taskDependentKeys(taskId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
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
