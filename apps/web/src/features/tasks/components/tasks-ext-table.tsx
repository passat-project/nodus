import { useMemo } from 'react';
import type { ListSort, TaskListItem, ViewSort } from '@nodus/contracts';
import { projectsAvailable } from '../../../shared/api/projects-available.js';
import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { taskRowValue } from '../../../shared/views/list-ext/list-field-values.js';
import {
  listFieldOfColumn,
  type ListExtParams,
} from '../../../shared/views/list-ext/list-ext-query.js';
import { useGroupKeyLabeler } from '../../../shared/views/list-ext/use-list-lookups.js';
import type { ListExtState } from '../../../shared/views/list-ext/use-list-ext.js';
import { DataTable } from '../../../shared/views/data-table.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { useFilteredList } from '../../../shared/views/use-list-toolbar.js';
import { useTaskTableFields } from '../../../shared/views/task-table-fields.js';
import { useTasksPages } from '../api/tasks-api.js';

/**
 * Плоский журнал задач с расширением (#435): когда в панели выбрана
 * группировка, журнал-дерево сменяется плоской таблицей той же машины
 * shared/views — заголовки групп со счётчиком и итогами (свернуть/развернуть),
 * строка итогов, серверная сортировка по любой колонке. Реестр колонок —
 * единый плоский список задач (task-table-fields), память вида «tasks.list»
 * общая с деревом (id колонок совпадают).
 */
export function TasksExtTable({
  scope,
  search,
  extParams,
  ext,
  filter,
}: {
  scope: 'mine' | 'all';
  search?: string;
  extParams: ListExtParams;
  ext: ListExtState;
  /** Остаток клиентской фильтрации (атрибуты уже применил сервер). */
  filter?: ActiveListFilter<TaskListItem>;
}) {
  const deciderOnly = filter?.state.role === 'decider';
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useTasksPages(
    scope,
    deciderOnly ? 'decider' : undefined,
    search,
    extParams,
  );
  const openCard = useOpenCard();
  const fields = useTaskTableFields({ projectVisible: projectsAvailable() });
  const { data: definitions } = useCustomFieldDefinitions('task');
  const labeler = useGroupKeyLabeler('task', definitions, {
    optionsByField: optionsByDefs(filter?.defs),
  });
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const rows = useFilteredList(items, filter);

  const serverSort = useMemo<ViewSort | null>(() => {
    const first = extParams.sort[0] as ListSort | undefined;
    return first ? { field: columnIdOfServer(first.field), dir: first.dir } : null;
  }, [extParams.sort]);

  return (
    <DataTable
      viewKey="tasks.list"
      selectable={false}
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
      ext={{
        serverSort,
        onServerSortCycle: (fieldId) =>
          ext.cycleColumnSort(fieldId, (id) => listFieldOfColumn(id, 'task')),
        isServerSortable: (field: { id: string }) => listFieldOfColumn(field.id, 'task') !== null,
        groups: extParams.group
          ? {
              buckets: data?.pages[0]?.groups ?? [],
              keyOf: (task) => taskRowValue(task, extParams.group!.field),
              labelOf: (key) => labeler(extParams.group!.field, key),
            }
          : undefined,
        totals:
          extParams.totals.length > 0
            ? { values: data?.pages[0]?.totals ?? [], defs: extParams.totals }
            : undefined,
      }}
    />
  );
}

/** Колонка реестра для поля сервера: id совпадают (кроме редко расходящихся —
 *  стрелка не показывается, сортировка всё равно действует). */
function columnIdOfServer(field: string): string {
  return field;
}

/** Варианты атрибутных полей из дефов панели (подписи ключей групп enum). */
function optionsByDefs(
  defs: readonly { id: string; options?: { value: string; label: string }[] }[] | undefined,
): Map<string, { value: string; label: string }[]> {
  const map = new Map<string, { value: string; label: string }[]>();
  for (const def of defs ?? []) {
    if (def.options?.length) map.set(def.id, def.options);
  }
  return map;
}
