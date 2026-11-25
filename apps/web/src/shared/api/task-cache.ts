import type { QueryClient } from '@tanstack/react-query';
import type { Paginated, TaskListItem } from '@nodus/contracts';

import { publishTaskItem, taskOverlayItem } from './task-overlay.js';
import { mapTaskInPages, tasksKeys } from './tasks-keys.js';

/**
 * Витрины строки задачи (#1051). Одна задача видна пользователю в нескольких
 * кэшах: страницы журнала (`listPages`), колонки канбана и локальный борд
 * доски. Правка обязана доходить до всех сразу (I4), ответ сервера — писаться
 * в те же витрины вместо перезапроса.
 */

type ListPages = Parameters<typeof mapTaskInPages>[0];

/** Строка задачи из кэшей журнала, колонок досок или оверлея. */
export function findTaskItem(queryClient: QueryClient, taskId: string): TaskListItem | undefined {
  for (const [, data] of queryClient.getQueriesData<ListPages>({
    queryKey: tasksKeys.listPages(),
  })) {
    const found = data?.pages
      .find((page) => page.items.some((t) => t.id === taskId))
      ?.items.find((t) => t.id === taskId);
    if (found) return found;
  }
  for (const query of queryClient.getQueryCache().findAll({ queryKey: tasksKeys.kanbanAll() })) {
    const found = (query.state.data as Paginated<TaskListItem> | undefined)?.items.find(
      (t) => t.id === taskId,
    );
    if (found) return found;
  }
  return taskOverlayItem(taskId);
}

/**
 * Правка строки на досках: публикует патченную строку в оверлей (журнал и
 * деталь патчит мутация). Вызывать ДО правки кэшей: `patch` получает строку,
 * какой она была до правки. Возвращает прежнюю строку для отката —
 * `undefined`, когда задачи нет ни в одной витрине (оверлей не трогали).
 *
 * `optimistic = false` — итоговое значение без ответа сервера (сервер
 * вернул не строку задачи, а часть: пункт чек-листа). Такая запись снимается
 * следующей свежей страницей колонки; оптимистичная — только ответом.
 */
export function publishOptimisticTask(
  queryClient: QueryClient,
  taskId: string,
  patch: (current: TaskListItem) => Partial<TaskListItem>,
  optimistic = true,
): TaskListItem | undefined {
  const current = findTaskItem(queryClient, taskId);
  if (!current) return undefined;
  publishTaskItem({ ...current, ...patch(current) }, optimistic);
  return current;
}

/** Откат оптимистичной правки на досках после ошибки мутации. */
export function restoreTaskOverlay(previous: TaskListItem | undefined): void {
  if (previous) publishTaskItem(previous);
}

/**
 * Ответ сервера мутации — во все витрины строки: журнал (на месте) и оверлей
 * досок (дождётся свежей страницы колонки). Без этого правка была видна на
 * доске только после перезапроса всех колонок.
 */
export function applyServerTask(queryClient: QueryClient, task: TaskListItem): void {
  queryClient.setQueriesData<ListPages>({ queryKey: tasksKeys.listPages() }, (old) =>
    mapTaskInPages(old, task.id, () => task),
  );
  publishTaskItem(task);
}
