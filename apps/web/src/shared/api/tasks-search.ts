import { useQuery } from '@tanstack/react-query';
import type { Paginated, TaskListItem } from '@nodus/contracts';

import { api } from '../api-client.js';
import { tasksKeys } from './tasks-keys.js';

/** Поиск задач (палитра Ctrl+K, пикер ссылок): серверный фильтр по титулу/
 *  номеру — industry-паттерн: клиент не держит весь список ради поиска.
 *  Один ключ кэша с хуком features/tasks — страницы не дублируются. */
export function useTasksSearch(q: string) {
  return useQuery({
    queryKey: tasksKeys.search(q),
    queryFn: () => api<Paginated<TaskListItem>>(`/tasks?search=${encodeURIComponent(q)}&limit=20`),
    enabled: q.length > 0,
  });
}
