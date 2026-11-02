import type { NodeKind } from '@nodus/contracts';
import type { RowSelection } from '../../../../shared/views/use-row-selection.js';
import type { StructureField } from './structure-cells.js';
import {
  StructureNoNodeRowView,
  StructureNodeRowView,
  StructureTaskRowView,
} from './structure-rows.js';
import { nodeMenuItems, taskMenuItems, type StructureMenuActions } from './structure-menus.js';
import type { StructureRow, StructureTaskRow } from '../lib/structure-tree.js';
import type { StructureDnd } from '../lib/use-structure-dnd.js';

/** Рендер строк дерева структуры: узлы, задачи-листья и секция «Без узла».
 *  Вложенность — отступами (как в проводнике), без линий и точек. Вынесен
 *  из вкладки (I5); состояние и мутации остаются у вкладки — здесь вид. */
export function StructureRowList({
  treeRows,
  noNodeRow,
  noNodeTasks,
  kindById,
  collapsed,
  noNodeCollapsed,
  fields,
  grid,
  selection,
  dnd,
  target,
  actions,
  canEdit,
  onToggleBranch,
  onSelectNode,
  onToggleNoNode,
  onOpenTask,
  onMoveTasks,
  onRemoveFromStructure,
}: {
  treeRows: StructureRow[];
  noNodeRow: Extract<StructureRow, { kind: 'noNode' }> | null;
  noNodeTasks: StructureRow[];
  kindById: Map<string, NodeKind>;
  collapsed: ReadonlySet<string>;
  noNodeCollapsed: boolean;
  fields: readonly StructureField[];
  grid: { templateColumns: string };
  selection: RowSelection;
  dnd: StructureDnd;
  target: StructureDnd['dropTarget'];
  actions: StructureMenuActions;
  canEdit: boolean;
  onToggleBranch: (id: string) => void;
  /** Выбор папки для панели «Свойства» (клик по строке). */
  onSelectNode: (id: string) => void;
  onToggleNoNode: () => void;
  onOpenTask: (id: string, anchor?: HTMLElement) => void;
  onMoveTasks: (ids: string[]) => void;
  onRemoveFromStructure: (id: string) => void;
}) {
  const zoneOf = (id: string) =>
    target && target.overId === `node:${id}` && !target.invalid ? target.zone : null;
  const selectedTaskIds = [...selection.selected]
    .filter((key) => key.startsWith('t:'))
    .map((key) => key.slice(2));

  const renderTask = (row: StructureTaskRow, inStructure: boolean) => (
    <StructureTaskRowView
      key={row.task.id}
      row={row}
      collapsed={collapsed.has(row.task.id)}
      onToggle={() => onToggleBranch(row.task.id)}
      selected={selection.selected.has(`t:${row.task.id}`)}
      onToggleSelected={() => selection.toggle(`t:${row.task.id}`)}
      items={taskMenuItems(row.task.id, {
        open: (id, anchor) => onOpenTask(id, anchor),
        moveTasks: onMoveTasks,
        removeFromStructure: onRemoveFromStructure,
        inStructure,
        canMove: canEdit,
      })}
      onOpen={(anchor) => onOpenTask(row.task.id, anchor)}
      dragData={{
        kind: 'tasks',
        taskIds:
          selection.selected.has(`t:${row.task.id}`) && selectedTaskIds.length > 1
            ? selectedTaskIds
            : [row.task.id],
      }}
      isDragging={dnd.active?.kind === 'tasks' && dnd.active.taskIds.includes(row.task.id)}
      fields={fields}
      grid={grid}
      showSelection={canEdit}
      readOnly={!canEdit}
    />
  );

  return (
    <>
      <div>
        {treeRows.map((row) => {
          if (row.kind === 'noNode') return null;
          if (row.kind === 'node') {
            return (
              <StructureNodeRowView
                key={row.node.id}
                row={row}
                kind={kindById.get(row.node.kindId)}
                collapsed={collapsed.has(row.node.id)}
                onToggle={() => onToggleBranch(row.node.id)}
                selected={selection.selected.has(`n:${row.node.id}`)}
                onToggleSelected={() => selection.toggle(`n:${row.node.id}`)}
                onSelect={() => onSelectNode(row.node.id)}
                items={nodeMenuItems(row.node, actions, canEdit)}
                zone={zoneOf(row.node.id)}
                invalid={target?.overId === `node:${row.node.id}` && target.invalid}
                isDragging={dnd.active?.kind === 'node' && dnd.active.nodeId === row.node.id}
                fields={fields}
                grid={grid}
                showSelection={canEdit}
                readOnly={!canEdit}
              />
            );
          }
          return renderTask(row, row.task.nodeId !== null);
        })}
      </div>
      {noNodeRow ? (
        <StructureNoNodeRowView
          count={noNodeRow.count}
          dropActive={target?.overId === 'no-node' && !target.invalid}
          collapsed={noNodeCollapsed}
          onToggle={onToggleNoNode}
        />
      ) : null}
      {noNodeTasks.map((row) => (row.kind === 'task' ? renderTask(row, false) : null))}
    </>
  );
}
