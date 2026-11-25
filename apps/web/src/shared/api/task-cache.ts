import type { QueryClient } from '@tanstack/react-query';
import type { TaskListItem } from '@nodus/contracts';

import {
  publishTaskItem,
  publishTaskPatch,
  restoreTaskOverlay,
  type OverlayToken,
  type TaskFacePatch,
} from './task-overlay.js';
import { mapTaskInPages, tasksKeys } from './tasks-keys.js';

export { restoreTaskOverlay, type OverlayToken, type TaskFacePatch };

/**
 * Витрины строки задачи (#1051). Одна задача видна пользователю в нескольких
 * кэшах: страницы журнала (`listPages`) и локальный борд доски (колонки и
 * догруженные карточки). Правка обязана доходить до всех сразу (I4), ответ
 * сервера — писаться в те же витрины вместо перезапроса.
 */

type ListPages = Parameters<typeof mapTaskInPages>[0];

/** Правка полей строки на досках — до ответа сервера: патч накладывается на
 *  карточку в борде. Возвращает прежнюю запись для отката
 *  (`restoreTaskOverlay`). Вызывать ДО правки кэшей. */
export function publishTaskFace(
  taskId: string,
  patch: TaskFacePatch,
  optimistic = true,
): OverlayToken {
  return publishTaskPatch(taskId, patch, optimistic);
}

/** Ответ сервера мутации — во все витрины строки: журнал (на месте) и оверлей
 * досок (дождётся свежей страницы колонки). Без этого правка была видна на
 * доске только после перезапроса всех колонок. */
export function applyServerTask(queryClient: QueryClient, task: TaskListItem): void {
  queryClient.setQueriesData<ListPages>({ queryKey: tasksKeys.listPages() }, (old) =>
    mapTaskInPages(old, task.id, () => task),
  );
  publishTaskItem(task);
}
