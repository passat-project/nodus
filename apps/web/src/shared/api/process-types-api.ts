import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskDetail, TaskListItem, ProcessType } from '@nodus/contracts';
import { DEFAULT_TASK_TYPE_CODE, typeViewerOf, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../api-client.js';
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
      toast.error(numberingErrorText(error) ?? ui.common.saveError);
    },
  });
}
