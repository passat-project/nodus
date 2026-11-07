import { useCallback, useMemo, useRef, useState } from 'react';
import { Permission, ui } from '@nodus/contracts';
import { Trash2 } from 'lucide-react';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { DataTableHeader } from '../../../shared/views/data-table-header.js';
import { LEADING_COL_W, type RowMenuItem } from '../../../shared/views/row-menu.js';
import { sortRows } from '../../../shared/views/sort-rows.js';
import { useAutoFitColumn } from '../../../shared/views/use-autofit-column.js';
import { useInfiniteSentinel } from '../../../shared/views/use-infinite-sentinel.js';
import { useRowSelection } from '../../../shared/views/use-row-selection.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { useFilteredList } from '../../../shared/views/use-list-toolbar.js';
import { useViewFields } from '../../../shared/views/use-view-fields.js';
import { uiPx } from '../../../shared/ui/ui-scale.js';
import { EdgeHints } from '../../../shared/ui/board/board-scroller.js';
import { useBoardEdgeScroll } from '../../../shared/ui/board/use-board-edge-scroll.js';
import { useTasksPages, usePrefetchTask } from '../api/tasks-api.js';
import type { TaskListItem } from '@nodus/contracts';
import { useTaskListFields } from '../lib/task-fields.js';
import { buildTaskRows, filterVisibleRows, type TaskRow } from '../lib/task-tree.js';
import { graphWidth, TaskListTree } from './task-list-graph.js';
import { makeCardRowMenuItems } from '../../../shared/views/card-row-menu.js';
import { TaskListRow } from './task-list-row.js';
import { TaskBulkIsland } from './task-bulk-island.js';
import { TaskDeleteDialog } from './task-delete-dialog.js';
import { TasksEmpty } from './tasks-empty.js';

/**
 * Список задач (вид «Список»): иерархия со сворачиванием веток, как папки в
 * проводнике. Граф вложенности — единый SVG-оверлей (непрерывные рёбра без
 * зазоров, каскадное построение при раскрытии, ширина колонки растёт с
 * глубиной). Таблица — модель Битрикса: все колонки фиксированной ширины
 * (без fr-компенсации — ручка ресайза следует за курсором 1:1, соседние
 * колонки не «уезжают»), ширина таблицы — по содержимому, при переполнении —
 * горизонтальный скролл. Настройки — шестерёнка в шапке страницы, ширина —
 * ручкой на грани хедера, с памятью между сессиями.
 */
export function TaskList({
  filter,
  onCreate,
  scope = 'mine',
}: {
  filter?: ActiveListFilter<TaskListItem>;
  onCreate?: () => void;
  scope?: 'mine' | 'all';
}) {
  // Пресет «Ждут моего решения» (#433) — серверный срез: role=decider,
  // scope принудительно all. Клиентский фильтр по странице соврёт на пагинации.
  const deciderOnly = filter?.state.role === 'decider';
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useTasksPages(
    scope,
    deciderOnly ? 'decider' : undefined,
  );
  const openCard = useOpenCard();
  const prefetch = usePrefetchTask();
  // Удаление из журнала (канон меню строки, 25.10.2026): пункт виден тому, кому
  // сервер разрешит удаление — постановщику или держателю task.manage_any.
  const meId = useAuthStore((s) => s.user?.id);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canManageAny = (permissions ?? []).includes(Permission.TASK_MANAGE_ANY);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  /** Каскадное построение графа: база = индекс первой раскрытой строки,
   *  key перезапускает draw-on только нового раскрытия. */
  const [reveal, setReveal] = useState({ base: 0, key: 1 });
  const taskListFields = useTaskListFields();
  const { visibleFields, sort, setWidth, cycleSort, commitOrder } = useViewFields(
    'tasks.list',
    taskListFields,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  // Локальный фильтр строки инструментов: сужает загруженное (дерево строится
  // из видимого; родитель вне фильтра отображается корнем — ограничение
  // клиентской фильтрации дерева, до серверной).
  const filtered = useFilteredList(items, filter);
  // Сортировка (концепт #4): ПЛОСКИЙ список до построения дерева — получается
  // сортировка СИБЛИНГОВ внутри веток, структура дерева не ломается.
  const sorted = useMemo(
    () => sortRows(filtered, sort, taskListFields, (t) => t.id),
    [filtered, sort, taskListFields],
  );
  const rows = useMemo(() => buildTaskRows(sorted), [sorted]);
  const visible = useMemo(() => filterVisibleRows(rows, collapsed), [rows, collapsed]);
  // Множественный выбор строк (модель Битрикс24, вердикт 15.09.2026):
  // та же механика, что в DataTable (useRowSelection + ведущая колонка).
  const visibleKeys = useMemo(() => visible.map((row) => row.task.id), [visible]);
  const { selected, toggle, toggleAll, clear, headerChecked } = useRowSelection(visibleKeys);
  const selectedIds = useMemo(() => [...selected], [selected]);

  // Бесконечная подгрузка страниц: sentinel у дна скролл-контейнера таблицы
  // (shared-хук, модель битриксовского журнала).
  useInfiniteSentinel(containerRef, sentinelRef, {
    hasNextPage,
    isFetchingNextPage,
    onLoadMore: fetchNextPage ? () => void fetchNextPage() : undefined,
  });

  const gridTemplateColumns = useMemo(() => {
    const maxDepth = visible.reduce((max, row) => Math.max(max, row.depth), 0);
    return `${LEADING_COL_W}px ${graphWidth(maxDepth)}px ${visibleFields.map((f) => `${f.width ?? uiPx(120)}px`).join(' ')}`;
  }, [visibleFields, visible]);

  /** Раскрытие/сворачивание ветки (стабильная ссылка — пропс строки). */
  const toggleBranch = useCallback(
    (taskId: string) => {
      const expanding = collapsed.has(taskId);
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        return next;
      });
      if (expanding) {
        const parentIndex = visible.findIndex((row) => row.task.id === taskId);
        setReveal((prev) => ({ base: parentIndex + 1, key: prev.key + 1 }));
      } else {
        setReveal((prev) => ({ base: Number.MAX_SAFE_INTEGER, key: prev.key + 1 }));
      }
    },
    [collapsed, visible],
  );

  /** Автоподбор ширины (двойной клик на ручке): shared-хук, сдвиг на
   *  ведущую колонку (выбор+меню) и колонку графа. */
  const autoFitColumn = useAutoFitColumn(containerRef, 2, setWidth);
  // Подвод курсора к краю листает широкий журнал (механика канбана).
  const [hovered, setHovered] = useState(false);
  const edge = useBoardEdgeScroll(containerRef, { pan: false, mounted: !isLoading });

  const openTask = useCallback(
    (row: TaskRow, rowEl: HTMLElement) => {
      openCard({ kind: 'task', id: row.task.id }, rowEl.getBoundingClientRect());
    },
    [openCard],
  );

  /** Меню строки («шашка», модель Битрикса24) — ПОЛНЫЙ набор команд сущности
   *  (вердикт владельца 25.10.2026): открытие карточки и deep-link в стек
   *  (shared/views/card-row-menu) + «Удалить задачу», если сервер это
   *  разрешит (постановщик или task.manage_any). */
  const taskRowMenu = useCallback(
    (row: TaskRow): RowMenuItem[] => {
      const base = makeCardRowMenuItems({ kind: 'task', id: row.task.id }, (ref) => openCard(ref));
      const canDelete = canManageAny || (meId !== undefined && row.task.creator.id === meId);
      if (!canDelete) return base;
      return [
        ...base,
        {
          id: 'delete',
          icon: <Trash2 className="size-3.5" />,
          label: ui.tasks.deleteTask,
          danger: true,
          separatorBefore: true,
          onSelect: () => setDeleteTarget(row.task.id),
        },
      ];
    },
    [canManageAny, meId, openCard],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    // Островок массовых действий живёт ВНЕ скролл-контейнера таблицы:
    // висит над низом зоны, не уезжает со строками (#311).
    <div
      className="relative h-full"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        ref={containerRef}
        role="table"
        aria-label={ui.tasks.title}
        className="h-full overflow-auto"
        {...edge.handlers}
      >
        <DataTableHeader
          fields={visibleFields}
          sort={sort}
          headerChecked={headerChecked}
          hasActions={false}
          style={{ gridTemplateColumns }}
          afterLeading={<span />}
          onToggleAll={toggleAll}
          onResize={(fieldId, w) => setWidth(fieldId, w)}
          onAutoFit={autoFitColumn}
          onCycleSort={cycleSort}
          onReorder={commitOrder}
        />
        {items.length === 0 && onCreate ? (
          <div className="flex justify-center px-6 pt-16">
            <TasksEmpty onCreate={onCreate} />
          </div>
        ) : null}
        <div className="relative">
          {visible.map((row) => (
            <TaskListRow
              key={row.task.id}
              row={row}
              isSelected={selected.has(row.task.id)}
              branchCollapsed={collapsed.has(row.task.id)}
              fields={visibleFields}
              gridTemplateColumns={gridTemplateColumns}
              onOpen={openTask}
              onHover={prefetch}
              onToggleSelected={toggle}
              onToggleBranch={toggleBranch}
              rowMenu={taskRowMenu}
            />
          ))}
          <TaskListTree
            rows={visible}
            width={graphWidth(visible.reduce((max, row) => Math.max(max, row.depth), 0))}
            revealBase={reveal.base}
            revealKey={reveal.key}
          />
        </div>
        {hasNextPage ? (
          <div ref={sentinelRef} className="flex justify-center py-3">
            <Skeleton className="h-8 w-48" />
          </div>
        ) : null}
        {/* Запас под островок: последняя строка не прячется под ним. */}
        {selected.size > 0 ? <div aria-hidden className="h-24" /> : null}
      </div>
      <EdgeHints room={edge.room} hot={edge.hot} show={hovered} />
      <TaskBulkIsland
        selectedIds={selectedIds}
        selectedTasks={visible.filter((row) => selected.has(row.task.id)).map((row) => row.task)}
        onClear={clear}
      />
      {deleteTarget ? (
        <TaskDeleteDialog taskId={deleteTarget} open onClose={() => setDeleteTarget(null)} />
      ) : null}
    </div>
  );
}
