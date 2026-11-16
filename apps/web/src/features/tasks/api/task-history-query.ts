import { useInfiniteQuery } from '@tanstack/react-query';
import type { Paginated, TaskHistoryItem } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';

/**
 * Журнал задачи (вкладка «История», I9): события `task.*` из event log,
 * свежие первыми, курсором «Показать ещё». Источник правды для необратимых и
 * прочих нажатий (#633, аудит Б3): строка остаётся, даже если чат выключен и
 * нажавший не состоит в беседе задачи.
 */
export function useTaskHistory(taskId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: tasksKeys.history(taskId),
    queryFn: ({ pageParam, signal }) =>
      api<Paginated<TaskHistoryItem>>(
        `/tasks/${taskId}/history${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 30_000,
  });
}
