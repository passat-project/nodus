import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import type { ProjectNode } from '@nodus/contracts';
import { Permission, ui } from '@nodus/contracts';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useOpenCard } from '../../../../app/shell/use-card-stack.js';
import { useAuthStore } from '../../../../shared/auth-store.js';
import { projectsKeys } from '../../../../shared/api/projects-list.js';
import { tasksKeys } from '../../../../shared/api/tasks-keys.js';
import { openTaskCreate } from '../../../../shared/tasks/task-create-store.js';
import { EdgeHints } from '../../../../shared/ui/board/board-scroller.js';
import { useBoardEdgeScroll } from '../../../../shared/ui/board/use-board-edge-scroll.js';
import { DataTableHeader } from '../../../../shared/views/data-table-header.js';
import { useAutoFitColumn } from '../../../../shared/views/use-autofit-column.js';
import {
  structureKeys,
  useMoveNode,
  useMoveTaskNode,
  useSetTasksNode,
} from '../api/structure-api.js';
import { useStructureModel } from '../lib/use-structure-model.js';
import { useStructureDnd } from '../lib/use-structure-dnd.js';
import { StructureBulkIsland } from './structure-bulk-island.js';
import { StructureDragPlate } from './structure-drag-plate.js';
import { StructureDialogHost, type StructureDialog } from './structure-dialog-host.js';
import { NodeKindsDialog } from './node-kinds-dialog.js';
import { StructureRowList } from './structure-row-list.js';
import type { StructureMenuActions } from './structure-menus.js';
import { StructureEmpty, StructureSearchEmpty, StructureToolbar } from './structure-toolbar.js';

/**
 * Вкладка «Структура» карточки проекта (#467, ADR-0030): дерево узлов-папок
 * с задачами-листьями и агрегатами поддерева (часы план/факт, сроки,
 * прогресс), секция «Без узла». Каркас — единый список портала: тулбар
 * `ListToolbar`, шапка `DataTableHeader`, горизонтальный скролл с подводом к
 * краю, ведущая колонка «чекбокс + шашка» как в «Задачах». Вложенность —
 * SVG-контур (как дерево задач), двойной клик раскрывает папку. DnD: зоны
 * четверти, линия вставки, подсветка папки, авто-раскрытие; строки статичны.
 */
export function StructureTab({
  projectId,
  canManage,
  readOnly,
}: {
  projectId: string;
  canManage: boolean;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const openCard = useOpenCard();
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canSetup = (permissions ?? []).includes(Permission.PROJECT_SETUP_MANAGE);
  const canEdit = canManage && !readOnly;
  const model = useStructureModel(projectId);
  const [dialog, setDialog] = useState<StructureDialog | null>(null);
  const [kindsOpen, setKindsOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const moveNode = useMoveNode(projectId);
  const moveTask = useMoveTaskNode(projectId);
  const setTasksNode = useSetTasksNode(projectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoFitColumn = useAutoFitColumn(containerRef, 1, model.setWidth);

  const dnd = useStructureDnd({
    nodes: model.nodes,
    expanded: (id) => !model.collapsed.has(id),
    expand: (id) =>
      model.setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    onDropNode: (nodeId, parentId, beforeId, afterId) => {
      if (!canEdit) return;
      moveNode.mutate({
        nodeId,
        parentId,
        ...(beforeId ? { beforeId } : {}),
        ...(afterId ? { afterId } : {}),
      });
    },
    onDropTasks: (taskIds, nodeId) => {
      if (!canEdit) return;
      moveTasks(taskIds, nodeId);
    },
  });
  const edge = useBoardEdgeScroll(containerRef, {
    pan: false,
    mounted: !model.isLoading && model.nodes.length > 0,
  });

  function moveTasks(taskIds: string[], nodeId: string | null) {
    if (taskIds.length === 1) moveTask.mutate({ taskId: taskIds[0]!, nodeId });
    else setTasksNode.mutate({ taskIds, nodeId });
  }

  function toggleBranch(id: string) {
    model.setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addTaskToNode(node: ProjectNode) {
    openTaskCreate({
      projectId,
      nodeId: node.id,
      contextLabel: ui.structure.nodeContext.replace('{name}', node.name),
      onCreated: () => {
        void queryClient.invalidateQueries({ queryKey: structureKeys.of(projectId) });
        void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(projectId) });
        void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
      },
    });
  }

  const actions: StructureMenuActions = {
    createInside: (node) => setDialog({ kind: 'create', parent: node }),
    addTask: addTaskToNode,
    rename: (node) => setDialog({ kind: 'rename', node }),
    moveNode: (node) => setDialog({ kind: 'moveNode', node }),
    deleteNode: (node) => setDialog({ kind: 'delete', node }),
  };

  if (model.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const target = dnd.dropTarget;

  return (
    <div className="flex h-full flex-col">
      <StructureToolbar
        toolbar={model.toolbar}
        canEdit={canEdit}
        canSetup={canSetup}
        onCreateNode={() => setDialog({ kind: 'create', parent: null })}
        onExpandAll={() => model.setCollapsed(new Set())}
        onCollapseAll={() => model.setCollapsed(new Set(model.branchIds))}
        onKinds={() => setKindsOpen(true)}
      />
      <DndContext {...dnd.context}>
        <div
          className="relative min-h-0 flex-1"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <div
            ref={containerRef}
            role="table"
            aria-label={ui.projects.tabStructure}
            className="h-full overflow-auto"
            {...edge.handlers}
          >
            {model.nodes.length === 0 ? (
              <StructureEmpty onCreateNode={() => setDialog({ kind: 'create', parent: null })} />
            ) : model.filtered.length === 0 ? (
              <StructureSearchEmpty onReset={() => model.toolbar.setQuery('')} />
            ) : (
              <>
                <DataTableHeader
                  fields={model.visibleFields}
                  sort={model.sort}
                  headerChecked={model.selection.headerChecked}
                  hasActions={false}
                  showSelection={canEdit}
                  style={{ gridTemplateColumns: model.gridTemplateColumns }}
                  onToggleAll={model.selection.toggleAll}
                  onResize={model.setWidth}
                  onAutoFit={autoFitColumn}
                  onCycleSort={model.cycleSort}
                  onReorder={model.commitOrder}
                />
                <StructureRowList
                  treeRows={model.treeRows}
                  noNodeRow={model.noNodeRow}
                  noNodeTasks={model.noNodeTasks}
                  kindById={model.kindById}
                  collapsed={model.collapsed}
                  noNodeCollapsed={model.noNodeCollapsed}
                  fields={model.visibleFields}
                  grid={{ templateColumns: model.gridTemplateColumns }}
                  selection={model.selection}
                  dnd={dnd}
                  target={target}
                  actions={actions}
                  canEdit={canEdit}
                  onToggleBranch={toggleBranch}
                  onToggleNoNode={() => model.setNoNodeCollapsed((prev) => !prev)}
                  onOpenTask={(id, anchor) =>
                    openCard({ kind: 'task', id }, anchor?.getBoundingClientRect())
                  }
                  onMoveTasks={(ids) => setDialog({ kind: 'moveTasks', taskIds: ids })}
                  onRemoveFromStructure={(id) => moveTasks([id], null)}
                />
                {model.selection.selected.size > 0 ? <div aria-hidden className="h-24" /> : null}
              </>
            )}
          </div>
          <EdgeHints room={edge.room} hot={edge.hot} show={hovered} />
          <StructureBulkIsland
            selectedNodeIds={model.selectedNodeIds}
            selectedTaskIds={model.selectedTaskIds}
            pending={moveNode.isPending || moveTask.isPending || setTasksNode.isPending}
            onClear={model.selection.clear}
            onMoveTasks={(ids) => setDialog({ kind: 'moveTasks', taskIds: ids })}
            onMoveNodes={(ids) => setDialog({ kind: 'moveNodes', nodeIds: ids })}
          />
        </div>
        <DragOverlay>
          {dnd.active ? (
            <StructureDragPlate
              active={dnd.active}
              nodes={model.nodes}
              kinds={model.kinds}
              tasks={model.tasks}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      {dialog ? (
        <StructureDialogHost
          projectId={projectId}
          dialog={dialog}
          kinds={model.kinds}
          nodes={model.nodes}
          onClose={() => setDialog(null)}
          onMoveTasks={moveTasks}
        />
      ) : null}
      <NodeKindsDialog open={kindsOpen} canManage={canSetup} onClose={() => setKindsOpen(false)} />
    </div>
  );
}
