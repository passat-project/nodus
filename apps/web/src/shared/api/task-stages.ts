import { queryOptions, useQuery } from '@tanstack/react-query';
import type { TaskStageWithCount } from '@nodus/contracts';

import { api } from '../api-client.js';

/** Каталог стадий со счётчиками колонок (шапки канбанов, сводка страницы
 *  задач). Общий: потребители — задачи (страница, карточка) и проектная
 *  доска (колонки = стадии схемы проекта, ADR-0008). Ключ совпадает с
 *  tasksKeys.stages() — общий кэш; каталог одного типа — подключ (сброс
 *  префиксом задевает оба). */
export const taskStagesKey = ['tasks', 'stages'] as const;

/** Без typeId — статусы всех живых типов (подписи «Тип · Статус» там, где
 *  типов больше одного); с typeId — статусы маршрута одного типа (колонки
 *  доски, массовая смена стадии). */
export function taskStagesOptions(typeId?: string) {
  return queryOptions({
    queryKey: typeId ? [...taskStagesKey, typeId] : taskStagesKey,
    queryFn: () =>
      api<TaskStageWithCount[]>(
        typeId ? `/tasks/stages?typeId=${encodeURIComponent(typeId)}` : '/tasks/stages',
      ),
    // Справочник: редко меняется в сессии — без staleTime каждый маунт доски
    // переспрашивал стадии (аудит #45: 301 запрос на 50 переключений вида).
    staleTime: 60_000,
  });
}

export function useTaskStages(typeId?: string, options?: { enabled?: boolean }) {
  return useQuery({ ...taskStagesOptions(typeId), enabled: options?.enabled ?? true });
}
