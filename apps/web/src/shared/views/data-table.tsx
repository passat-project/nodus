import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { ui } from '@nodus/contracts';

import { DataTableHeader } from './data-table-header.js';
import { LEADING_COL_W, RowMenu, type RowMenuItem } from './row-menu.js';
import { sortRows } from './sort-rows.js';
import { useAutoFitColumn } from './use-autofit-column.js';
import { useInfiniteSentinel } from './use-infinite-sentinel.js';
import { useRowSelection, type RowSelection } from './use-row-selection.js';
import { useViewFields, type FieldDef, type ViewField } from './use-view-fields.js';
import { EdgeHints } from '../ui/board/board-scroller.js';
import { useBoardEdgeScroll } from '../ui/board/use-board-edge-scroll.js';
import { uiPx } from '../ui/ui-scale.js';
import { cn } from '@nodus/ui/lib/utils';

/** Колонка канонической таблицы: поле реестра + рендер ячейки. */
export interface DataTableField<T> extends FieldDef {
  render: (row: T) => ReactNode;
  /** Значение для сортировки (концепт #4): задано → заголовок кликабелен
   *  (↑/↓); на бэке id поля = имя параметра `?sort=field:dir`. */
  sortValue?: (row: T) => string | number | null;
}

interface DataTableRowProps<T> {
  row: T;
  /** Ключ строки — готовый: `rowKey(row)` вызывается один раз на рендер
   *  таблицы, а не в каждой строке (стабильный примитив для memo). */
  rowKey: string;
  isSelected: boolean;
  fields: readonly ViewField<DataTableField<T>>[];
  gridTemplateColumns: string;
  onOpenRow: (row: T, rowEl: HTMLElement) => void;
  onHoverRow?: (row: T) => void;
  onToggle: (key: string) => void;
  actions?: (row: T) => ReactNode;
  rowMenu?: (row: T) => RowMenuItem[];
}

/**
 * Строка журнала, отдельная и мемоизированная (A6-4, #632): таблица — одна
 * компонента, и любой её рендер (ховер, подвод курсора к краю, выбор строки)
 * перерисовывал ВСЕ строки, а их в журнале сотни. Пропсы — только данные
 * строки: функции потребителя (`onOpenRow`/`actions`/`rowMenu`) приходят
 * ссылками с его рендера и в самой таблице не меняются, `selection` больше
 * не уходит множеством в каждую строку — только свой булев флаг.
 */
function DataTableRowInner<T>({
  row,
  rowKey,
  isSelected,
  fields,
  gridTemplateColumns,
  onOpenRow,
  onHoverRow,
  onToggle,
  actions,
  rowMenu,
}: DataTableRowProps<T>) {
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={(e) => onOpenRow(row, e.currentTarget)}
      onPointerEnter={() => onHoverRow?.(row)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenRow(row, e.currentTarget);
        }
      }}
      className={cn(
        'grid h-12 w-max min-w-full cursor-pointer items-stretch gap-3 border-b border-border/60 px-4 transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_3rem] last:border-b-0 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring',
        isSelected && 'bg-accent/50',
      )}
      style={{ gridTemplateColumns }}
    >
      {/* Ведущая ячейка: чекбокс выбора + «шашка» меню (клики не
      всплывают до строки — открытие карточки не срабатывает). */}
      <span
        role="cell"
        className="flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggle(rowKey)}
          aria-label={ui.common.selectRow}
        />
        <RowMenu items={rowMenu?.(row) ?? []} />
      </span>
      {fields.map((field) => (
        <span
          key={field.id}
          role="cell"
          data-cell-field={field.id}
          className="flex min-w-0 items-center gap-2 overflow-hidden"
        >
          {field.render(row)}
        </span>
      ))}
      {actions ? (
        <span
          role="cell"
          className="flex items-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {actions(row)}
        </span>
      ) : null}
    </div>
  );
}

/** memo с сохранением дженерика: строка перерисовывается только когда
 *  меняются ЕЁ данные или её собственный флаг выбора. */
const DataTableRow = memo(DataTableRowInner) as typeof DataTableRowInner;

/**
 * Таблица-канон (модель AG Grid/Битрикса, references/views-customization.md) —
 * общая машина всех журналов/списков портала (потребители: журнал писем,
 * список проектов, задачи проекта, сотрудники):
 * — ВСЕ колонки — фиксированные px-треки (fr запрещён: резиновая колонка
 *   компенсирует дельту ресайза — ручка отрывается от курсора, gotchas);
 * — единый grid на хедер и строки, w-max min-w-full: пустое место справа,
 *   переполнение — горизонтальный скролл;
 * — ресайз ручкой на грани хедера (min под контент, max 640, 1:1 за курсором),
 *   dblclick — автоподбор по контенту (сумма scrollWidth ДЕТЕЙ ячеек);
 * — видимость/ширина колонок — шестерёнка ViewSettings того же viewKey,
 *   пресет переживает reload (nodus-views-v1);
 * — ПОРЯДОК колонок — dnd за заголовок (живой черновик: колонка едет целиком,
 *   коммит на drop), СОРТИРОВКА — клик по заголовку ↑/↓ (одна колонка,
 *   стабильная: тай-брейк по rowKey); обе — в пресет вида (концепт #4);
 * — строка — role=button + Enter/Space (вложенных кнопок в кнопке нет:
 *   ячейка действий — span со stopPropagation);
 * — ВЕДУЩАЯ колонка (вердикт владельца 15.09.2026, модель Битрикс24):
 *   чекбокс множественного выбора (хедер — «выбрать все» с indeterminate,
 *   выбранная строка — тон accent) + «шашка» контекстного меню строки
 *   (только реальные действия); не ресайзится и не прячется шестерёнкой;
 * — опциональная бесконечная подгрузка sentinel-ом (IntersectionObserver,
 *   root — скролл-контейнер таблицы).
 */
export function DataTable<T>({
  viewKey,
  defs,
  rows,
  rowKey,
  onOpenRow,
  onHoverRow,
  isLoading = false,
  isError = false,
  onRetry,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  actions,
  rowMenu,
  emptyTitle = ui.common.empty,
  label,
  selection: externalSelection,
}: {
  viewKey: string;
  defs: DataTableField<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Клик/Enter по строке: фича прокидывает rect источника в lastSource
   * (shared-element раскрытие слайдера) и навигирует. */
  onOpenRow: (row: T, rowEl: HTMLElement) => void;
  onHoverRow?: (row: T) => void;
  isLoading?: boolean;
  /** Ошибка загрузки: пустой список не должен выглядеть как «ничего нет». */
  isError?: boolean;
  onRetry?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  /** Ячейка действий строки (доп. auto-колонка; клики не всплывают до строки). */
  actions?: (row: T) => ReactNode;
  /** Пункты контекстного меню строки («шашка» в ведущей ячейке). */
  rowMenu?: (row: T) => RowMenuItem[];
  emptyTitle?: string;
  /** Доступное имя таблицы — название списка. Без него имя — `emptyTitle`
   *  (у отфильтрованного списка «Ничего не найдено» звучало бы названием). */
  label?: string;
  /** Внешнее управление выбором (островок массовых действий модуля): если не
   *  передан — таблица держит выбор сама. Один механизм во всех реестрах. */
  selection?: RowSelection;
}) {
  const { visibleFields, sort, setWidth, cycleSort, commitOrder } = useViewFields(viewKey, defs);
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const edge = useBoardEdgeScroll(containerRef, {
    pan: false,
    mounted: !isLoading && rows.length > 0,
  });

  // Сортировка строк (клиентская, концепт #4; ?sort= на бэке — отдельный
  // issue): стабильная, null — в конец (sort-rows).
  const sortedRows = useMemo(() => sortRows(rows, sort, defs, rowKey), [rows, sort, defs, rowKey]);

  const rowKeys = useMemo(() => sortedRows.map(rowKey), [sortedRows, rowKey]);
  const internalSelection = useRowSelection(rowKeys);
  const { selected, toggle, toggleAll, headerChecked } = externalSelection ?? internalSelection;

  // Бесконечная подгрузка страниц: sentinel у дна контейнера (shared-хук).
  useInfiniteSentinel(containerRef, sentinelRef, { hasNextPage, isFetchingNextPage, onLoadMore });

  const gridTemplateColumns = useMemo(() => {
    const tracks = [`${LEADING_COL_W}px`, ...visibleFields.map((f) => `${f.width ?? uiPx(120)}px`)];
    if (actions) tracks.push('auto');
    return tracks.join(' ');
  }, [visibleFields, actions]);

  /** Автоподбор ширины (двойной клик на ручке): shared-хук, сдвиг на
   *  ведущую колонку (выбор + меню). */
  const autoFitColumn = useAutoFitColumn(containerRef, 1, setWidth);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty>
          <EmptyTitle>{ui.customFields.block.loadError}</EmptyTitle>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-medium text-info underline-offset-2 hover:underline"
            >
              {ui.customFields.block.retry}
            </button>
          ) : null}
        </Empty>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
        </Empty>
      </div>
    );
  }

  return (
    // Семантика таблицы (аудит #45: div-grid без ролей; aria-sort жил на
    // span-кнопке — невалидно). Роли: table/row/columnheader(в хедере)/cell.
    // Широкая таблица листается подводом курсора к краю — та же механика,
    // что у канбана (индикаторы — соседи скролл-контейнера).
    <div
      className="relative h-full"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        ref={containerRef}
        role="table"
        aria-label={label ?? emptyTitle}
        className="h-full overflow-auto"
        {...edge.handlers}
      >
        <DataTableHeader
          fields={visibleFields}
          sort={sort}
          headerChecked={headerChecked}
          hasActions={actions !== undefined}
          style={{ gridTemplateColumns }}
          onToggleAll={toggleAll}
          onResize={(fieldId, w) => setWidth(fieldId, w)}
          onAutoFit={autoFitColumn}
          onCycleSort={cycleSort}
          onReorder={commitOrder}
        />
        {sortedRows.map((row) => {
          const key = rowKey(row);
          return (
            <DataTableRow
              key={key}
              row={row}
              rowKey={key}
              isSelected={selected.has(key)}
              fields={visibleFields}
              gridTemplateColumns={gridTemplateColumns}
              onOpenRow={onOpenRow}
              onHoverRow={onHoverRow}
              onToggle={toggle}
              actions={actions}
              rowMenu={rowMenu}
            />
          );
        })}
        {hasNextPage ? (
          <div ref={sentinelRef} className="flex justify-center py-3">
            {isFetchingNextPage ? <Skeleton className="h-8 w-48" /> : <span className="h-1" />}
          </div>
        ) : null}
      </div>
      <EdgeHints room={edge.room} hot={edge.hot} show={hovered} />
    </div>
  );
}
