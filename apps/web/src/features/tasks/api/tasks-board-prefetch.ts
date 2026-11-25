import type { QueryClient } from '@tanstack/react-query';
import type { Paginated, TaskListItem } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { personalStagesOptions } from '../../../shared/api/task-create.js';
import { taskStagesOptions } from '../../../shared/api/task-stages.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { kanbanColumnKey } from '../../../shared/lib/board/kanban-column-key.js';
import { KANBAN_FEED_LIMIT } from '../../../shared/ui/board/kanban-feed-limit.js';

/**
 * Ключ и фид канбана «Мой план» — общие для доски (`TaskKanban`) и предзагрузки:
 * предзагрузка кладёт первую страницу колонки под тот же ключ и той же
 * глубины. Меньшая страница сломала бы догрузку (курсор перескочил бы задачи).
 */
export function personalBoardKey(search = '') {
  return tasksKeys.kanban('personal', search.trim() || undefined);
}

export function personalBoardFeedUrl(
  stageId: string,
  cursor: string | null,
  limit: number,
  search = '',
): string {
  return `/tasks?personalStageId=${stageId}&limit=${limit}${
    search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''
  }${cursor ? `&cursor=${cursor}` : ''}`;
}

/**
 * Данные доски без поиска — в кэш заранее (#1051). Первое открытие «Задач»
 * шло двумя кругами подряд (справочники → колонки), и раздел ждал их после
 * клика. Роутер вызывает предзагрузку при наведении на раздел, прогрев — в
 * свободное время после входа: к клику доска уже в кэше.
 *
 * Отказ любой части глотается: страница спросит сама. Свежие данные (в пределах
 * staleTime) не перезапрашиваются — повторное наведение ничего не стоит.
 */
export async function prefetchPersonalBoard(queryClient: QueryClient): Promise<void> {
  void queryClient.prefetchQuery(taskStagesOptions()).catch(() => undefined);
  const stages = await queryClient
    .fetchQuery(personalStagesOptions)
    .catch(() => [] as { id: string }[]);
  const board = personalBoardKey();
  await Promise.all(
    stages.map((stage) =>
      queryClient
        .prefetchQuery({
          queryKey: kanbanColumnKey(board, stage.id),
          queryFn: () =>
            api<Paginated<TaskListItem>>(personalBoardFeedUrl(stage.id, null, KANBAN_FEED_LIMIT)),
          staleTime: 30_000,
        })
        .catch(() => undefined),
    ),
  );
}
