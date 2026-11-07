import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import type { CustomFieldValues, ProjectNode } from '@nodus/contracts';
import { Permission, ui } from '@nodus/contracts';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useOpenCard } from '../../../../app/shell/use-card-stack.js';
import { allowedNodeKinds } from '@nodus/contracts';
import { useAuthStore } from '../../../../shared/auth-store.js';
import { projectsKeys, useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { useCustomFieldFilterDefs } from '../../../../shared/custom-fields/filter-defs.js';
import { tasksKeys } from '../../../../shared/api/tasks-keys.js';
import { FormulaMovePreviewDialog } from '../../../../shared/custom-fields/formula/formula-move-preview-dialog.js';
import {
  previewTaskMoveBatch,
  useFormulaMoveGate,
  useNodeMovePreview,
  useTaskMovePreview,
} from '../../../../shared/custom-fields/formula/formula-move-preview.js';
import { openTaskCreate } from '../../../../shared/tasks/task-create-store.js';
import { EdgeHints } from '../../../../shared/ui/board/board-scroller.js';
import { useBoardEdgeScroll } from '../../../../shared/ui/board/use-board-edge-scroll.js';
import { DataTableHeader } from '../../../../shared/views/data-table-header.js';
import { isActiveFilter } from '../../../../shared/views/list-filters.js';
import { useAutoFitColumn } from '../../../../shared/views/use-autofit-column.js';
import { structureKeys, useMoveNode } from '../api/structure-api.js';
import { useMoveTaskNode, useSetTasksNode } from '../api/structure-task-mutations.js';
import { useProjectDetail } from '../../api/projects-api.js';
import { useStructureModel } from '../lib/use-structure-model.js';
import { useStructureDnd } from '../lib/use-structure-dnd.js';
import { filterVisibleRows } from '../lib/structure-tree.js';
import { StructureBulkIsland } from './structure-bulk-island.js';
import { StructureDragPlate } from './structure-drag-plate.js';
import { StructureDialogHost, type StructureDialog } from './structure-dialog-host.js';
import { NodePropertiesPanel } from './node-properties-panel.js';
import { StructureRowList } from './structure-row-list.js';
import type { StructureMenuActions } from './structure-menus.js';
import { StructureEmpty, StructureSearchEmpty, StructureToolbar } from './structure-toolbar.js';

/**
 * Вкладка «Структура» карточки проекта (#467, ADR-0030): дерево папок с
 * задачами-листьями и агрегатами поддерева (часы план/факт, сроки, прогресс),
 * секция «Без папки». Каркас — единый список портала: тулбар `ListToolbar`,
 * шапка `DataTableHeader`, горизонтальный скролл с подводом к краю, ведущая
 * колонка «чекбокс + шашка» как в «Задачах». DnD: зоны четверти, линия
 * вставки, подсветка папки, авто-раскрытие; строки статичны. Справа —
 * вталкивающая панель «Свойства папки» (#556): открывается пунктом меню и
 * следует за кликом по папке.
 */
/** Значения атрибутов папки для фильтров: стабильная ссылка (memo фильтров). */
function nodeValuesOf(node: ProjectNode): CustomFieldValues {
  return node.customFields ?? {};
}

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
  const project = useProjectDetail(projectId);
  const projectTypes = useProjectTypes(true);
  const definitions = useCustomFieldDefinitions('node');
  // Виды папок, допустимые типу проекта (#556): окно создания и смена вида
  // предлагают только их; сервер проверяет то же (422 KIND_NOT_ALLOWED).
  const allowedKinds = allowedNodeKinds(
    projectTypes.data?.find((type) => type.id === project.data?.type?.id)?.kindIds ?? null,
    model.kinds,
  );
  const [dialog, setDialog] = useState<StructureDialog | null>(null);
  const [propertiesId, setPropertiesId] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const moveNode = useMoveNode(projectId);
  const moveTask = useMoveTaskNode(projectId);
  const setTasksNode = useSetTasksNode(projectId);
  // Превью формульного диффа перед переносом (#632): непустой дифф — окно
  // подтверждения, пустой — перенос сразу.
  const gate = useFormulaMoveGate();
  const nodePreview = useNodeMovePreview(projectId);
  const taskPreview = useTaskMovePreview();
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
      void gate.offer(nodePreview.mutateAsync({ nodeId, parentId }), () =>
        moveNode.mutate({
          nodeId,
          parentId,
          ...(beforeId ? { beforeId } : {}),
          ...(afterId ? { afterId } : {}),
        }),
      );
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

  const propertiesNode = propertiesId
    ? (model.nodes.find((node) => node.id === propertiesId) ?? null)
    : null;

  // Фильтры по атрибутам папок (#631): группа «Атрибуты» панели фильтра —
  // атрибуты, привязанные к видам папок. Применяются как поиск: папки-
  // совпадения с путём до корня; задачи и «Без папки» фильтром скрываются
  // (фильтр описывает папки, не их содержимое).
  const filterDefs = useCustomFieldFilterDefs('node', nodeValuesOf);
  const attributeView = useMemo(() => {
    const active = filterDefs.filter((def) => isActiveFilter(model.toolbar.filters[def.id]));
    if (active.length === 0) return null;
    const matches = (node: ProjectNode) =>
      active.every((def) => def.match(node, model.toolbar.filters[def.id]));
    const keep = new Set<number>();
    model.filtered.forEach((row, index) => {
      if (row.kind !== 'node' || !matches(row.node)) return;
      keep.add(index);
      let depth = row.depth;
      for (let j = index - 1; j >= 0 && depth > 0; j -= 1) {
        const prev = model.filtered[j];
        if (prev && prev.kind !== 'noNode' && prev.depth < depth) {
          keep.add(j);
          depth = prev.depth;
        }
      }
    });
    return filterVisibleRows(
      model.filtered.filter((_, index) => keep.has(index)),
      new Set(),
    );
  }, [filterDefs, model.filtered, model.toolbar.filters]);
  const treeRows = attributeView ?? model.treeRows;
  const noNodeRow = attributeView ? null : model.noNodeRow;
  const noNodeTasks = attributeView ? [] : model.noNodeTasks;

  /** Перенос задач в папку (DnD, меню, «Без папки»): одиночный — с диффом
   *  формул (превью → окно или сразу перенос), пачка — со СВОДНЫМ диффом по
   *  первым `BULK_PREVIEW_LIMIT` записям. Bulk больше не уходит в мутацию
   *  молча (A9-1): «что изменится» спрашивается у любого переноса, а окно
   *  честно говорит, по скольким записям собрана сводка. */
  function moveTasks(taskIds: string[], nodeId: string | null) {
    const apply = () => setTasksNode.mutate({ taskIds, nodeId });
    const [taskId] = taskIds;
    if (taskIds.length === 1 && taskId) {
      const run = taskPreview.mutateAsync({ taskId, nodeId });
      void gate.offer(run, () => moveTask.mutate({ taskId, nodeId }));
      return;
    }
    void gate.offer(previewTaskMoveBatch(taskIds, nodeId), apply);
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
    properties: (node) => setPropertiesId(node.id),
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
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <StructureToolbar
          toolbar={model.toolbar}
          defs={filterDefs}
          fields={model.fields}
          canEdit={canEdit}
          onCreateNode={() => setDialog({ kind: 'create', parent: null })}
          onExpandAll={() => model.setCollapsed(new Set())}
          onCollapseAll={() => model.setCollapsed(new Set(model.branchIds))}
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
              ) : (attributeView ?? model.filtered).length === 0 ? (
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
                    treeRows={treeRows}
                    noNodeRow={noNodeRow}
                    noNodeTasks={noNodeTasks}
                    kindById={model.kindById}
                    collapsed={model.collapsed}
                    noNodeCollapsed={model.noNodeCollapsed}
                    fields={model.visibleFields}
                    attributes={model.attributeDefinitions}
                    refs={model.nodeRefs}
                    grid={{ templateColumns: model.gridTemplateColumns }}
                    selection={model.selection}
                    dnd={dnd}
                    target={target}
                    actions={actions}
                    canEdit={canEdit}
                    onToggleBranch={toggleBranch}
                    onSelectNode={setPropertiesId}
                    onToggleNoNode={() => model.setNoNodeCollapsed((prev) => !prev)}
                    onOpenTask={(id, anchor) =>
                      openCard({ kind: 'task', id }, anchor?.getBoundingClientRect())
                    }
                    onMoveTasks={(ids) => setDialog({ kind: 'moveTasks', taskIds: ids })}
                    onRemoveFromStructure={(id) => moveTasks([id], null)}
                  />
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
            kinds={allowedKinds}
            nodes={model.nodes}
            canSetup={canSetup}
            onClose={() => setDialog(null)}
            onMoveTasks={moveTasks}
          />
        ) : null}
        {/* Подтверждение переноса DnD: дифф формул — до мутации. */}
        <FormulaMovePreviewDialog {...gate.dialogProps} />
      </div>
      <NodePropertiesPanel
        projectId={projectId}
        node={propertiesNode}
        kinds={allowedKinds}
        definitions={definitions.data ?? []}
        refs={model.customFieldRefs}
        canEdit={canEdit}
        onClose={() => setPropertiesId(null)}
      />
    </div>
  );
}
