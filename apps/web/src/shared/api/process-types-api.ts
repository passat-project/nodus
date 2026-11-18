import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskDetail, TaskListItem, ProcessType } from '@nodus/contracts';
import {
  DEFAULT_TASK_TYPE_CODE,
  errorMessages,
  typeConfigOf,
  typeViewerOf,
  ui,
  type CreationScope,
  type ProcessCategory,
} from '@nodus/contracts';
import { toast } from 'sonner';

import { api, ApiError } from '../api-client.js';
import {
  isNumberConfirmCancelled,
  numberingErrorText,
  withEmptyNumberConfirm,
} from '../custom-fields/number-confirm.js';
import { automationKeys } from './automation-keys.js';
import { tasksKeys } from './tasks-keys.js';

/**
 * Типы процессов категории «задача» для потребителей вне фичи automation
 * (единое окно создания, смена типа в карточке, доска проекта) — кросс-
 * фичевые хуки в shared, канон task-stages.ts. Сами CRUD типов —
 * features/automation. Категория `task` — фильтр сервера и клиента: задачи
 * не видят типы писем (ADR-0024).
 *
 * С #432 сервер отдаёт `viewer` (что можно текущему пользователю) и форму
 * создания типа: хуки отсекают невидимое и недоступное к созданию (I8 —
 * сервер всё равно проверит и ответит 403).
 */

/** Типы, по которым сотрудник может создавать задачи (выбор в окне). */
export function useCreatableProcessTypes() {
  return useQuery({
    queryKey: automationKeys.types('exclude', 'task'),
    queryFn: () => api<ProcessType[]>('/workflows/types?category=task'),
    staleTime: 60_000,
    select: (types: ProcessType[]) =>
      types.filter((t) => t.category === 'task' && t.creatable && typeViewerOf(t).canCreate),
  });
}

/** Тип по умолчанию (Р9/О10): код `task` («Стандартный»), если его можно
 *  создать, иначе первый доступный. Совпадает с умолчанием сервера — форма
 *  и созданная задача не расходятся. */
export function defaultTaskType(
  types: readonly ProcessType[] | undefined,
): ProcessType | undefined {
  const list = types ?? [];
  const standard = list.find((t) => t.code === DEFAULT_TASK_TYPE_CODE);
  return standard ?? list[0];
}

/** Живые типы, видимые сотруднику (смена типа — только доступные, Р6). */
export function useAliveProcessTypes() {
  return useQuery({
    queryKey: automationKeys.types('exclude', 'task'),
    queryFn: () => api<ProcessType[]>('/workflows/types?category=task'),
    staleTime: 60_000,
    select: (types: ProcessType[]) =>
      types.filter((t) => !t.archivedAt && t.category === 'task' && typeViewerOf(t).canView),
  });
}

/**
 * Живые типы категории для настроек (#665): «Что здесь можно создавать» в
 * типе проекта и «Где создаётся» в типе процесса показывают ОДИН справочник
 * с двух сторон. Доступ смотрящего здесь не фильтруется — это настройка.
 */
export function useLiveProcessTypes(category: ProcessCategory) {
  return useQuery({
    queryKey: automationKeys.types('exclude', category),
    queryFn: () => api<ProcessType[]>(`/workflows/types?category=${category}`),
    staleTime: 60_000,
    select: (types: ProcessType[]) => types.filter((t) => !t.archivedAt && t.category === category),
  });
}

/**
 * «Где создаётся» (#665, ADR-0041 п.9): правка связи в настройках ТИПА —
 * одна точка записи, поэтому обе стороны (тип проекта и тип процесса)
 * показывают одно и то же. Раздел конфигурации заменяется целиком.
 */
export function useUpdateTypeCreation() {
  const queryClient = useQueryClient();
  const lists = () => queryClient.getQueriesData<ProcessType[]>({ queryKey: automationKeys.all });
  return useMutation({
    // Мутации одного типа — по очереди: два быстрых тумблера не перетирают
    // разделы друг друга (канон настроек типа, #432).
    scope: { id: 'process-type-creation' },
    mutationFn: ({ typeId, creation }: { typeId: string; creation: CreationScope }) =>
      api<ProcessType>(`/workflows/types/${typeId}/config`, {
        method: 'PATCH',
        body: { creation },
      }),
    onMutate: async ({ typeId, creation }) => {
      await queryClient.cancelQueries({ queryKey: automationKeys.all });
      const snapshots = lists().map(([key, data]) => ({ key, data }));
      for (const [key, data] of lists()) {
        if (!data) continue;
        queryClient.setQueryData<ProcessType[]>(
          key,
          data.map((type) =>
            type.id === typeId ? { ...type, config: { ...typeConfigOf(type), creation } } : type,
          ),
        );
      }
      return { snapshots };
    },
    onSuccess: (updated) => {
      for (const [key, data] of lists()) {
        if (!data) continue;
        queryClient.setQueryData<ProcessType[]>(
          key,
          data.map((type) => (type.id === updated.id ? updated : type)),
        );
      }
    },
    onError: (error, _vars, context) => {
      for (const snapshot of context?.snapshots ?? []) {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      }
      toast.error(
        error instanceof ApiError && error.code in errorMessages
          ? errorMessages[error.code as keyof typeof errorMessages]
          : ui.common.saveError,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

/** Смена типа задачи (#378): если текущего статуса нет в новом маршруте —
 *  обязателен stageId. Доступ к целевому типу проверяет сервер (403). Тип с
 *  номером «при создании» выдаёт номер в этот момент (#630): вне нужной
 *  папки — отказ с причиной, пустое поле в номере — окно и повтор. */
export function useChangeProcessType(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { typeId: string; stageId?: string }) =>
      withEmptyNumberConfirm((confirmed) =>
        api<TaskListItem>(`/tasks/${taskId}/type`, {
          method: 'POST',
          body: confirmed ? { ...body, confirmEmptyNumberParts: true } : body,
        }),
      ),
    onSuccess: (item) => {
      // Ответ — строка задачи (контракт), не деталь: мержим поля строки,
      // деталь (маршрут задачи сменился) — перезапрос.
      queryClient.setQueryData<TaskDetail>(tasksKeys.detail(taskId), (prev) =>
        prev ? { ...prev, ...item } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: tasksKeys.detail(taskId) });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.listPages() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.transitions(taskId) });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.actions(taskId) });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.kanbanAll() });
    },
    onError: (error) => {
      if (isNumberConfirmCancelled(error)) return;
      toast.error(
        numberingErrorText(error) ??
          (error instanceof ApiError && error.code in errorMessages
            ? errorMessages[error.code as keyof typeof errorMessages]
            : ui.common.saveError),
      );
    },
  });
}
