import { useQuery } from '@tanstack/react-query';
import type { Paginated, TaskListItem } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';

/** Задачи для контекста ассистента: первая страница журнала. ВЫДЕЛЕННЫЙ ключ
 *  контекста: общий ключ listPages занят useInfiniteQuery журнала — формы
 *  Paginated и InfiniteData затирали бы друг друга в кэше (блокер валидации
 *  16.11.2026). Канон I3/I6: фича не импортирует query-хуки другой фичи —
 *  ключи и api-клиент живут в shared. Scope как у журнала — карточка,
 *  открытая из списка, обязана находиться в контексте. */
export function useAssistantTasks() {
  return useQuery({
    queryKey: tasksKeys.assistantContext(),
    queryFn: () => api<Paginated<TaskListItem>>('/tasks?view=list&scope=all&limit=100'),
  });
}
