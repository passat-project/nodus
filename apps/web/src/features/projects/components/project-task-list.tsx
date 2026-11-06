import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { DataTable } from '../../../shared/views/data-table.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { useFilteredList } from '../../../shared/views/use-list-toolbar.js';
import { useTaskTableFields } from '../../../shared/views/task-table-fields.js';
import type { TaskListItem } from '@nodus/contracts';
import { useProjectTaskPages } from '../api/projects-api.js';

/** Вид «Список» карточки проекта: те же задачи (фильтр projectId, плейбук
 *  §3.3) канонической таблицей на общей машине shared/views — свой ключ
 *  вида `projects.tasks` (отдельная память колонок от журнала задач).
 *  Открытие — карточка задачи ПОВЕРХ карточки проекта (стек, ADR-0009).
 *  Реестр колонок — хук: атрибуты портала (#632) приходят с сервера, поэтому
 *  реестр меняется вместе с ними; «Проект» по умолчанию скрыт — список
 *  открыт в контексте проекта. */
export function ProjectTaskList({
  projectId,
  filter,
}: {
  projectId: string;
  filter?: ActiveListFilter<TaskListItem>;
}) {
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useProjectTaskPages(projectId);
  const openCard = useOpenCard();
  const fields = useTaskTableFields({ projectVisible: false });

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const rows = useFilteredList(items, filter);

  return (
    <DataTable
      viewKey="projects.tasks"
      defs={fields}
      rows={rows}
      rowKey={(task) => task.id}
      isLoading={isLoading}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={() => void fetchNextPage()}
      onOpenRow={(task, rowEl) =>
        openCard({ kind: 'task', id: task.id }, rowEl.getBoundingClientRect())
      }
    />
  );
}
