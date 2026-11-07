import { memo } from 'react';
import { ui } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { cn } from '@nodus/ui/lib/utils';

import { RowMenu, type RowMenuItem } from '../../../shared/views/row-menu.js';
import type { ViewField } from '../../../shared/views/use-view-fields.js';
import type { ListFieldDef } from '../lib/task-fields.js';
import type { TaskRow } from '../lib/task-tree.js';
import { graphX } from './task-list-graph.js';

/**
 * Строка дерева задач (A6-4, #632) — отдельная и мемоизированная: выбор
 * строки, ховер и подвод курсора к краю перерисовывали все строки журнала.
 * Пропсы — только данные строки и СТАБИЛЬНЫЕ ссылки (useCallback в списке):
 * свой флаг выбора, а не множество `selected` целиком.
 */

export interface TaskListRowProps {
  row: TaskRow;
  isSelected: boolean;
  branchCollapsed: boolean;
  fields: readonly ViewField<ListFieldDef>[];
  gridTemplateColumns: string;
  /** Стабильные ссылки (useCallback выше): мемоизация строки без них мертва. */
  onOpen: (row: TaskRow, rowEl: HTMLElement) => void;
  onHover: (taskId: string) => void;
  onToggleSelected: (taskId: string) => void;
  onToggleBranch: (taskId: string) => void;
  rowMenu: (row: TaskRow) => RowMenuItem[];
}

export const TaskListRow = memo(function TaskListRow({
  row,
  isSelected,
  branchCollapsed,
  fields,
  gridTemplateColumns,
  onOpen,
  onHover,
  onToggleSelected,
  onToggleBranch,
  rowMenu,
}: TaskListRowProps) {
  const { task } = row;
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={(e) => onOpen(row, e.currentTarget)}
      onPointerEnter={() => onHover(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(row, e.currentTarget);
        }
      }}
      className={cn(
        'group/row grid h-12 w-max min-w-full cursor-pointer items-stretch gap-3 border-b border-border/60 px-4 transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_3rem] last:border-b-0 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring',
        isSelected && 'bg-accent/50',
      )}
      style={{ gridTemplateColumns }}
    >
      {/* Ведущая ячейка (выбор + «шашка»): клики не всплывают
        до строки — ветку/карточку не открывает. */}
      <span
        role="cell"
        className="flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelected(task.id)}
          aria-label={ui.common.selectRow}
        />
        <RowMenu items={rowMenu(row)} />
      </span>
      <div role="cell" className="relative">
        {row.hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleBranch(task.id);
            }}
            aria-expanded={!branchCollapsed}
            aria-label={branchCollapsed ? ui.tasks.expandBranch : ui.tasks.collapseBranch}
            className="absolute top-1/2 -translate-y-1/2 cursor-pointer text-port/70 transition-colors duration-200 group-hover/row:text-port hover:text-port"
            style={{ left: graphX(row.depth) - 9 }}
          >
            <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
              <circle
                cx={9}
                cy={9}
                r={7}
                fill="var(--card)"
                stroke="currentColor"
                strokeWidth={1}
              />
              <path
                d={branchCollapsed ? 'M6,9 L12,9 M9,6 L9,12' : 'M6,9 L12,9'}
                stroke="currentColor"
                strokeWidth={1.25}
              />
            </svg>
          </button>
        ) : null}
      </div>
      {fields.map((field) => (
        <span
          key={field.id}
          role="cell"
          data-cell-field={field.id}
          className="flex min-w-0 items-center gap-2 overflow-hidden"
        >
          {field.render(task, { branchCollapsed, childCount: row.childCount })}
        </span>
      ))}
    </div>
  );
});
