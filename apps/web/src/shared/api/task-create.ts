import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTaskBody, TaskListItem, TaskStageWithCount } from '@nodus/contracts';

import { api } from '../api-client.js';
import { withEmptyNumberConfirm } from '../custom-fields/number-confirm.js';
import { tasksKeys } from './tasks-keys.js';

/** Личная схема «Мой план» (ADR-0008): колонки личной доски со счётчиками.
 *  В shared — потребители и фича задач, и общая экспресс-форма
 *  (`shared/tasks`, в т.ч. из карточки сотрудника). */
export function usePersonalStages() {
  return useQuery({
    queryKey: tasksKeys.personalStages(),
    queryFn: () => api<TaskStageWithCount[]>('/tasks/personal-stages'),
    // Справочник личной схемы: см. useTaskStages (staleTime, аудит #45).
    staleTime: 60_000,
  });
}

/** Создание задачи (канбан-плюсик колонки и экспресс-форма). Доски
 *  инвалидируются тоже: задача из экспресс-формы (топбар, мессенджер,
 *  карточка сотрудника) должна появиться на «Моём плане» без перезагрузки
 *  (вердикт владельца 16.10). Плюсик колонки вставляет карточку сразу сам. */
export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    // Номер «при создании» с пустым полем (#630): окно «Выдать так /
    // Вернуться» и повтор с подтверждением — задача создаётся один раз.
    mutationFn: (body: CreateTaskBody) =>
      withEmptyNumberConfirm((confirmed) =>
        api<TaskListItem>('/tasks', {
          method: 'POST',
          body: confirmed ? { ...body, confirmEmptyNumberParts: true } : body,
        }),
      ),
    onSettled: (_data, _error, body) => {
      void queryClient.invalidateQueries({ queryKey: tasksKeys.personalStages() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.listPages() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.kanbanAll() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.stages() });
      // Подзадача из быстрого входа (#432): карточка родителя показывает
      // новую строку сразу после ответа.
      if (body.parentId) {
        void queryClient.invalidateQueries({ queryKey: tasksKeys.detail(body.parentId) });
      }
    },
  });
}
