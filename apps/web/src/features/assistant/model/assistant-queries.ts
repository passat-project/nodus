import { useQuery } from '@tanstack/react-query';
import type { Paginated, TaskListItem } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';

/** Задачи для контекста ассистента: первая страница журнала поверх ОБЩЕГО
 *  ключа tasksKeys (канон: фича не импортирует query-хуки другой фичи, I3/I6 —
 *  ключи и api-клиент живут в shared). Scope как у журнала задач — карточка,
 *  открытая из списка, обязана находиться в контексте. */
export function useAssistantTasks() {
  return useQuery({
    queryKey: tasksKeys.listPages({ scope: 'all' }),
    queryFn: () => api<Paginated<TaskListItem>>('/tasks?view=list&scope=all&limit=100'),
  });
}
