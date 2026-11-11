import { Fragment, useId, useRef, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Switch } from '@nodus/ui/components/switch';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@nodus/ui/components/tooltip';

import { EdgeHints } from '../ui/board/board-scroller.js';
import { useBoardEdgeScroll } from '../ui/board/use-board-edge-scroll.js';
import { uiPx } from '../ui/ui-scale.js';

/**
 * Матрица «право × роль» (#379, ADR-0034) — презентационная и общая:
 * о ролях и правах не знает, всё приходит пропсами (переиспользует #432).
 *
 * Грамматика канонической таблицы (`shared/views/data-table`): фиксированные
 * px-треки без `fr`, единый grid `w-max min-w-full`, пустое место справа,
 * переполнение — горизонтальный скролл с подводом к краю. Колонки задаются
 * данными (вид не настраивается), поэтому ресайза и шестерёнки нет.
 *
 * Закрепление: шапка `sticky top-0`, колонка прав — `sticky left-0` на
 * непрозрачном `bg-card` (тонируется ховером строки через слой-оверлей,
 * чтобы прокручиваемые ячейки не просвечивали).
 */

export interface AccessMatrixRow {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Заголовок группы: подряд идущие строки одной группы объединены полосой. */
  readonly group?: string;
}

export interface AccessMatrixColumn {
  readonly id: string;
  readonly name: string;
  /** Подсказка у имени (например, описание роли). */
  readonly title?: string;
  /** Задан → столбец заблокирован: замок в шапке + подсказка. */
  readonly lockedHint?: string;
  /** Своя шапка столбца (имя, меню, участники): заменяет стандартную подпись. */
  readonly header?: ReactNode;
}

export interface AccessMatrixCell {
  readonly granted: boolean;
  readonly disabled: boolean;
  /** Почему флажок недоступен (Tooltip при наведении). */
  readonly hint?: string;
  /** Запрос в полёте: `aria-busy`, без спиннера. */
  readonly pending?: boolean;
}

const ROW_HEADER_W = uiPx(360);
const ROLE_COL_W = uiPx(176);
const TRAILING_COL_W = uiPx(64);

export function AccessMatrix({
  label,
  rowHeader,
  rows,
  columns,
  cell,
  onToggle,
  cellLabel,
  describedBy,
  trailingHeader,
}: {
  /** Имя таблицы для скринридеров. */
  label: string;
  /** Заголовок колонки прав. */
  rowHeader: string;
  rows: readonly AccessMatrixRow[];
  columns: readonly AccessMatrixColumn[];
  cell: (rowId: string, columnId: string) => AccessMatrixCell;
  onToggle: (rowId: string, columnId: string, next: boolean) => void;
  cellLabel: (row: AccessMatrixRow, column: AccessMatrixColumn) => string;
  /** id видимой подсказки «только просмотр» (aria-describedby таблицы). */
  describedBy?: string;
  /** Узкий столбец справа от ролей (кнопка «+» — новая роль). */
  trailingHeader?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const edge = useBoardEdgeScroll(containerRef, { pan: false, mounted: rows.length > 0 });
  const hintPrefix = useId();
  const gridTemplateColumns = [
    ROW_HEADER_W,
    ...columns.map(() => ROLE_COL_W),
    ...(trailingHeader ? [TRAILING_COL_W] : []),
  ]
    .map((width) => `${width}px`)
    .join(' ');

  return (
    <div
      className="relative h-full"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        ref={containerRef}
        role="table"
        aria-label={label}
        aria-describedby={describedBy}
        className="h-full overflow-auto"
        {...edge.handlers}
      >
        <div
          role="row"
          className="sticky top-0 z-30 grid min-h-12 w-max min-w-full items-center gap-3 border-b border-border/60 bg-card"
          style={{ gridTemplateColumns }}
        >
          <span
            role="columnheader"
            className="sticky left-0 z-20 flex h-full items-center self-stretch border-r border-border/60 bg-card pr-2 pl-4"
          >
            <NodeLabel label={rowHeader} />
          </span>
          {columns.map((column) => {
            const hintId = `${hintPrefix}-locked-${column.id}`;
            return (
              <span
                role="columnheader"
                key={column.id}
                className="flex min-w-0 items-center justify-center gap-1.5 px-1"
                title={column.title}
              >
                {column.header ?? (
                  <>
                    <NodeLabel label={column.name} className="block min-w-0 truncate" />
                    {column.lockedHint ? <LockedBadge hint={column.lockedHint} /> : null}
                  </>
                )}
                {column.lockedHint ? (
                  <span id={hintId} className="sr-only">
                    {column.lockedHint}
                  </span>
                ) : null}
              </span>
            );
          })}
          {trailingHeader ? (
            <span role="columnheader" className="flex items-center justify-center">
              {trailingHeader}
            </span>
          ) : null}
        </div>

        {rows.map((row, index) => (
          <Fragment key={row.id}>
            {row.group && row.group !== rows[index - 1]?.group ? (
              <div
                role="row"
                className="grid h-10 w-max min-w-full items-center gap-3 border-b border-border/60 bg-muted/40"
                style={{ gridTemplateColumns }}
              >
                <span
                  role="columnheader"
                  className="sticky left-0 z-10 flex h-full items-center border-r border-border/60 bg-muted/40 pr-3 pl-4"
                >
                  <NodeLabel label={row.group} />
                </span>
              </div>
            ) : null}
            <div
              role="row"
              className="group grid min-h-16 w-max min-w-full items-stretch gap-3 border-b border-border/60 transition-colors last:border-b-0 hover:bg-accent/40"
              style={{ gridTemplateColumns }}
            >
              <span
                role="rowheader"
                className="relative sticky left-0 z-10 flex flex-col justify-center gap-0.5 border-r border-border/60 bg-card py-2 pr-2 pl-4 after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-accent/40 after:opacity-0 after:transition-opacity after:content-[''] group-hover:after:opacity-100"
              >
                <span className="text-body-xs font-medium">{row.label}</span>
                <span className="text-xs text-muted-foreground">{row.description}</span>
              </span>
              {columns.map((column) => {
                const state = cell(row.id, column.id);
                const labelText = cellLabel(row, column);
                const checkbox = (
                  <Switch
                    checked={state.granted}
                    disabled={state.disabled}
                    aria-label={labelText}
                    aria-busy={state.pending || undefined}
                    aria-describedby={
                      column.lockedHint ? `${hintPrefix}-locked-${column.id}` : undefined
                    }
                    onCheckedChange={(checked) => onToggle(row.id, column.id, checked === true)}
                  />
                );
                return (
                  <span role="cell" key={column.id} className="flex items-center justify-center">
                    {state.hint ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">{checkbox}</span>
                        </TooltipTrigger>
                        <TooltipContent>{state.hint}</TooltipContent>
                      </Tooltip>
                    ) : (
                      checkbox
                    )}
                  </span>
                );
              })}
            </div>
          </Fragment>
        ))}
      </div>
      <EdgeHints room={edge.room} hot={edge.hot} show={hovered} />
    </div>
  );
}

/** Замок заблокированного столбца с подсказкой (фокусируемый). */
export function LockedBadge({ hint }: { hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={hint}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
        >
          <Lock className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Скелетон в форме таблицы: настоящие строки прав + N столбцов-скелетов —
 *  высота не прыгает при появлении данных. */
export function AccessMatrixSkeleton({
  rowHeader,
  rows,
  columns = 4,
}: {
  rowHeader: string;
  rows: readonly AccessMatrixRow[];
  columns?: number;
}) {
  const gridTemplateColumns = [ROW_HEADER_W, ...Array.from({ length: columns }, () => ROLE_COL_W)]
    .map((width) => `${width}px`)
    .join(' ');
  return (
    <div className="h-full overflow-hidden">
      <div
        role="row"
        className="grid h-12 w-max min-w-full items-center gap-3 border-b border-border/60"
        style={{ gridTemplateColumns }}
      >
        <span className="pl-4">
          <NodeLabel label={rowHeader} />
        </span>
        {Array.from({ length: columns }, (_, index) => (
          <span key={index} className="px-1">
            <Skeleton className="h-4 w-24" />
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid min-h-16 w-max min-w-full items-center gap-3 border-b border-border/60 last:border-b-0"
          style={{ gridTemplateColumns }}
        >
          <span className="flex flex-col justify-center gap-1 py-2 pr-2 pl-4">
            <span className="text-body-xs font-medium">{row.label}</span>
            <span className="text-xs text-muted-foreground">{row.description}</span>
          </span>
          {Array.from({ length: columns }, (_, index) => (
            <span key={index} className="flex items-center justify-center">
              <Skeleton className="size-4 rounded-[0.25rem]" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
