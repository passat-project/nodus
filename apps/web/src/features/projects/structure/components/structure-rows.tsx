import { ChevronRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { CustomFieldRef, NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { attributeRefs } from '../../../../shared/views/attribute-fields.js';
import { uiPx } from '../../../../shared/ui/ui-scale.js';
import type { RowMenuItem } from '../../../../shared/views/row-menu.js';
import type { StructureNodeRow, StructureTaskRow } from '../lib/structure-tree.js';
import { NO_NODE_DROP_ID, type DragPayload } from '../lib/use-structure-dnd.js';
import {
  BranchButton,
  InsertLine,
  LeadingCell,
  nodeCell,
  rowBase,
  taskCell,
} from './structure-cells.js';
import type { StructureAttributeDefs, StructureField } from './structure-cells.js';
import { StructureContextMenu } from './structure-menus.js';

/** Строки таблицы структуры: узел-папка, задача-лист и секция «Без узла».
 *  Вложенность — отступами в ячейке названия (как в проводнике), без
 *  колонки графа, линий и точек. Пустые ячейки — пустые (без дефисов).
 *  Атрибутные ячейки (#632) получают определения и ссылки: у папок — срез
 *  структуры, у задач — ссылки самой задачи. */

const INDENT = uiPx(24);

const combineRefs =
  (...refs: ((el: HTMLElement | null) => void)[]) =>
  (el: HTMLElement | null) => {
    for (const ref of refs) ref(el);
  };

export function StructureNodeRowView({
  row,
  kind,
  collapsed,
  onToggle,
  selected,
  onToggleSelected,
  onSelect,
  items,
  zone,
  invalid,
  isDragging,
  fields,
  attributes,
  refs,
  grid,
  showSelection,
  readOnly,
}: {
  row: StructureNodeRow;
  kind: NodeKind | undefined;
  collapsed: boolean;
  onToggle: () => void;
  selected: boolean;
  onToggleSelected: () => void;
  /** Клик по строке — выбор папки для панели «Свойства» (#556). */
  onSelect: () => void;
  items: RowMenuItem[];
  /** Зона дропа над этой строкой (индикация). */
  zone: 'before' | 'into' | 'after' | null;
  invalid: boolean;
  isDragging: boolean;
  fields: readonly StructureField[];
  /** Определения атрибутных колонок по id поля (#632). */
  attributes: StructureAttributeDefs;
  /** Ссылки значений папок — карта по id (срез структуры проекта). */
  refs: ReadonlyMap<string, CustomFieldRef>;
  grid: { templateColumns: string };
  showSelection: boolean;
  readOnly: boolean;
}) {
  const drag = useDraggable({
    id: `node:${row.node.id}`,
    data: { kind: 'node', nodeId: row.node.id },
    disabled: readOnly,
  });
  const drop = useDroppable({ id: `node:${row.node.id}` });
  const style: CSSProperties = { gridTemplateColumns: grid.templateColumns };

  return (
    <StructureContextMenu items={items}>
      <div
        ref={combineRefs(drag.setNodeRef, drop.setNodeRef)}
        {...(readOnly ? {} : drag.attributes)}
        {...(readOnly ? {} : drag.listeners)}
        role="row"
        tabIndex={0}
        aria-expanded={row.hasChildren ? !collapsed : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button,a,input,[role=button]')) return;
          onSelect();
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button,a,input,[role=button]')) return;
          if (row.hasChildren) onToggle();
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && row.hasChildren) {
            e.preventDefault();
            onToggle();
          }
        }}
        style={style}
        className={cn(
          rowBase,
          'bg-muted/25 hover:bg-accent/30',
          !readOnly && 'cursor-grab',
          selected && 'bg-accent/50',
          isDragging && 'opacity-40',
          zone === 'into' && !invalid && 'bg-accent/60 ring-1 ring-ring/40 ring-inset',
          invalid && 'ring-1 ring-danger/40 ring-inset',
        )}
      >
        <InsertLine zone={zone === 'before' || zone === 'after' ? zone : null} />
        <LeadingCell
          selected={selected}
          onToggleSelected={onToggleSelected}
          items={items}
          showSelection={showSelection}
        />
        {fields.map((field) => (
          <span
            key={field.id}
            role="cell"
            data-cell-field={field.id}
            className="flex min-w-0 items-center gap-2 overflow-hidden"
            style={field.id === 'name' ? { paddingLeft: row.depth * INDENT } : undefined}
          >
            {field.id === 'name' ? (
              <>
                {row.hasChildren ? (
                  <BranchButton collapsed={collapsed} onToggle={onToggle} />
                ) : (
                  <span className="size-5 shrink-0" />
                )}
                {nodeCell(row, field.id, kind, attributes, refs)}
                {collapsed && row.descendantCount > 0 ? (
                  <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                    +{row.descendantCount}
                  </span>
                ) : null}
              </>
            ) : (
              nodeCell(row, field.id, kind, attributes, refs)
            )}
          </span>
        ))}
      </div>
    </StructureContextMenu>
  );
}

export function StructureTaskRowView({
  row,
  collapsed,
  onToggle,
  selected,
  onToggleSelected,
  items,
  onOpen,
  dragData,
  isDragging,
  fields,
  attributes,
  grid,
  showSelection,
  readOnly,
}: {
  row: StructureTaskRow;
  collapsed: boolean;
  onToggle: () => void;
  selected: boolean;
  onToggleSelected: () => void;
  items: RowMenuItem[];
  onOpen: (anchor: HTMLElement) => void;
  /** Мультиселект: за строкой тянется вся выборка. */
  dragData: DragPayload;
  isDragging: boolean;
  fields: readonly StructureField[];
  /** Определения атрибутных колонок по id поля (#632). */
  attributes: StructureAttributeDefs;
  grid: { templateColumns: string };
  showSelection: boolean;
  readOnly: boolean;
}) {
  const drag = useDraggable({
    id: `task:${row.task.id}`,
    data: dragData,
    disabled: readOnly,
  });
  // Ссылки значений задачи — карта по id, одна на строку (ячеек может быть
  // несколько: ссылочные атрибуты и списки).
  const taskRefs = attributeRefs(row.task);
  const style: CSSProperties = { gridTemplateColumns: grid.templateColumns };
  return (
    <StructureContextMenu items={items}>
      <div
        ref={drag.setNodeRef}
        {...(readOnly ? {} : drag.attributes)}
        {...(readOnly ? {} : drag.listeners)}
        role="row"
        tabIndex={0}
        aria-expanded={row.hasChildren ? !collapsed : undefined}
        onClick={(e) => onOpen(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(e.currentTarget);
          }
        }}
        style={style}
        className={cn(
          rowBase,
          'cursor-pointer hover:bg-accent/40',
          selected && 'bg-accent/50',
          isDragging && 'opacity-40',
        )}
      >
        <LeadingCell
          selected={selected}
          onToggleSelected={onToggleSelected}
          items={items}
          showSelection={showSelection}
        />
        {fields.map((field) => (
          <span
            key={field.id}
            role="cell"
            data-cell-field={field.id}
            className="flex min-w-0 items-center gap-2 overflow-hidden"
            style={field.id === 'name' ? { paddingLeft: row.depth * INDENT } : undefined}
          >
            {field.id === 'name' ? (
              <>
                {row.hasChildren ? (
                  <BranchButton collapsed={collapsed} onToggle={onToggle} />
                ) : (
                  <span className="size-5 shrink-0" />
                )}
                {taskCell(row.task, field.id, attributes, taskRefs)}
                {collapsed && row.descendantCount > 0 ? (
                  <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                    +{row.descendantCount}
                  </span>
                ) : null}
              </>
            ) : (
              taskCell(row.task, field.id, attributes, taskRefs)
            )}
          </span>
        ))}
      </div>
    </StructureContextMenu>
  );
}

/** Секция «Без узла» внизу дерева: заголовок + droppable-полоса для задач. */
export function StructureNoNodeRowView({
  count,
  dropActive,
  collapsed,
  onToggle,
}: {
  count: number;
  dropActive: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const drop = useDroppable({ id: NO_NODE_DROP_ID });
  return (
    <div
      ref={drop.setNodeRef}
      className={cn(
        'flex h-10 w-max min-w-full items-center gap-2 border-b border-border/60 bg-muted/40 px-4 text-muted-foreground transition-colors',
        dropActive && 'bg-accent/60 ring-1 ring-ring/40 ring-inset',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? ui.tasks.expandBranch : ui.tasks.collapseBranch}
        className="flex size-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
          strokeWidth={1.75}
        />
      </button>
      <span className="text-sm font-medium text-foreground">{ui.structure.noNodeSection}</span>
      <span className="font-mono text-label-sm tabular-nums">{count}</span>
      <span className="truncate text-label-sm">{ui.structure.noNodeHint}</span>
    </div>
  );
}
