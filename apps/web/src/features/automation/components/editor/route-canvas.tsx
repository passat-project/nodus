import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ControlButton,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
  type OnDelete,
  type OnNodeDrag,
  type XYPosition,
} from '@xyflow/react';
import { Redo2, Undo2 } from 'lucide-react';
import type { WorkflowDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { FlowCanvas } from '../../../../shared/flow/flow-canvas.js';
import {
  START_EDGE_ID,
  START_NODE_ID,
  buildRouteGraph,
  transitionOfAnyNode,
} from '../../../../shared/flow/route-graph.js';
import { handleIdOf } from '../../model/route-doc-ops.js';
import { useRouteDocStore } from '../../model/route-doc-store.js';

/**
 * Холст редактора маршрута (#378 ред. 2): граф из документа стора (общая
 * раскладка), перетаскивание живёт локально и попадает в документ одним
 * шагом на отпускании; соединение точек, перенос концов стрелок, подписи
 * вдоль стрелок, удаление выделенного (Delete) и отмена/повтор (Ctrl+Z /
 * Ctrl+Y и кнопки слева внизу). Без права — только просмотр.
 */
export function RouteCanvas({
  workflow,
  editable,
  problemStageIds,
}: {
  workflow: WorkflowDetail;
  editable: boolean;
  problemStageIds: ReadonlySet<string>;
}) {
  const doc = useRouteDocStore((s) => s.document);
  const selection = useRouteDocStore((s) => s.selection);
  const canUndo = useRouteDocStore((s) => s.past.length > 0);
  const canRedo = useRouteDocStore((s) => s.future.length > 0);
  const [drag, setDrag] = useState<{ id: string; position: XYPosition } | null>(null);

  const graph = useMemo(
    () =>
      buildRouteGraph(doc, {
        readOnly: !editable,
        problemStageIds,
        selection,
        stageEntityCounts: workflow.stageEntityCounts,
        onSelectTransition: (id) => useRouteDocStore.getState().select({ kind: 'transition', id }),
        onLabelT: editable ? (id, t) => useRouteDocStore.getState().setLabelT(id, t) : undefined,
        onBend: editable
          ? (id, param, value) => useRouteDocStore.getState().setEdgeBend(id, param, value)
          : undefined,
      }),
    [doc, selection, editable, problemStageIds, workflow.stageEntityCounts],
  );

  // Живой drag: узел (и старт за начальным статусом) едут локально.
  const nodes = useMemo(() => {
    if (!drag) return graph.nodes;
    const dragged = graph.nodes.find((n) => n.id === drag.id);
    const dx = dragged ? drag.position.x - dragged.position.x : 0;
    const dy = dragged ? drag.position.y - dragged.position.y : 0;
    const initialDragged = dragged?.type === 'status' && Boolean(dragged.data.isInitial);
    return graph.nodes.map((n) => {
      if (n.id === drag.id) return { ...n, position: drag.position };
      if (initialDragged && n.id === START_NODE_ID) {
        return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
      }
      return n;
    });
  }, [graph.nodes, drag]);

  const onNodeDrag: OnNodeDrag<Node> = useCallback((_event, node) => {
    setDrag({ id: node.id, position: node.position });
  }, []);

  const onNodeDragStop: OnNodeDrag<Node> = useCallback((_event, node) => {
    const store = useRouteDocStore.getState();
    const anyTransition = transitionOfAnyNode(node.id);
    if (anyTransition) store.setAnyAnchor(anyTransition, node.position);
    else if (node.type === 'status') store.setStagePosition(node.id, node.position);
    setDrag(null);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    const store = useRouteDocStore.getState();
    if (connection.source === START_NODE_ID) {
      store.patchStage(connection.target, { isInitial: true });
      return;
    }
    store.connect({
      source: connection.source,
      target: connection.target,
      sourceHandle: handleIdOf(connection.sourceHandle),
      targetHandle: handleIdOf(connection.targetHandle),
    });
  }, []);

  const onReconnect = useCallback((edge: Edge, connection: Connection) => {
    const store = useRouteDocStore.getState();
    if (edge.id === START_EDGE_ID) {
      store.patchStage(connection.target, { isInitial: true });
      return;
    }
    store.reconnect(edge.id, {
      source: connection.source,
      target: connection.target,
      sourceHandle: handleIdOf(connection.sourceHandle),
      targetHandle: handleIdOf(connection.targetHandle),
    });
  }, []);

  const isValidConnection: IsValidConnection = useCallback(
    (c) =>
      c.source !== c.target &&
      c.target !== START_NODE_ID &&
      transitionOfAnyNode(c.target) === null &&
      (c.source === START_NODE_ID ||
        transitionOfAnyNode(c.source) !== null ||
        useRouteDocStore.getState().document.stages.some((s) => s.id === c.source)),
    [],
  );

  const onDelete: OnDelete = useCallback(({ nodes: removedNodes, edges: removedEdges }) => {
    const stageIds = removedNodes.filter((n) => n.type === 'status').map((n) => n.id);
    const transitionIds = [
      ...removedNodes.map((n) => transitionOfAnyNode(n.id)).filter((id) => id !== null),
      ...removedEdges.filter((e) => e.id !== START_EDGE_ID).map((e) => e.id),
    ];
    useRouteDocStore.getState().removeElements(stageIds, transitionIds);
  }, []);

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — вне полей ввода (свои поля и редакторы
  // текста отменяют сами).
  useEffect(() => {
    if (!editable) return;
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      // Открытый диалог (публикация, уход со страницы) — документ за ним не трогаем.
      if (document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        useRouteDocStore.getState().undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        useRouteDocStore.getState().redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editable]);

  // Действие (#633) не узел холста: Delete снимает его, пока оно выделено
  // в панели. Статусы и стрелки удаляет сам React Flow (onDelete).
  useEffect(() => {
    if (!editable) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"]')) return;
      const selection = useRouteDocStore.getState().selection;
      if (selection?.kind !== 'action') return;
      event.preventDefault();
      useRouteDocStore.getState().removeAction(selection.id);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editable]);

  return (
    <FlowCanvas
      nodes={nodes}
      edges={graph.edges}
      fitKey={workflow.id}
      interactive={editable}
      onConnect={onConnect}
      onReconnect={onReconnect}
      isValidConnection={isValidConnection}
      onDelete={onDelete}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={(_event, node) => {
        // Любой узел холста открывает панель: статус — свою, метка «Любой
        // статус» — панель своей кнопки, «Создание задачи» — панель «Окно
        // создания» (#432, В1; начальный статус настраивается в своей панели).
        const store = useRouteDocStore.getState();
        const anyTransition = transitionOfAnyNode(node.id);
        if (anyTransition) store.select({ kind: 'transition', id: anyTransition });
        else if (node.type === 'status') store.select({ kind: 'stage', id: node.id });
        else if (node.id === START_NODE_ID) store.select({ kind: 'creation', id: 'creation' });
      }}
      onEdgeClick={(_event, edge) => {
        if (edge.id !== START_EDGE_ID) {
          useRouteDocStore.getState().select({ kind: 'transition', id: edge.id });
        }
      }}
      onPaneClick={() => useRouteDocStore.getState().select(null)}
      controls={
        editable ? (
          <>
            <ControlButton
              onClick={() => useRouteDocStore.getState().undo()}
              disabled={!canUndo}
              title={ui.automation.undo}
              aria-label={ui.automation.undo}
            >
              <Undo2 strokeWidth={1.75} />
            </ControlButton>
            <ControlButton
              onClick={() => useRouteDocStore.getState().redo()}
              disabled={!canRedo}
              title={ui.automation.redo}
              aria-label={ui.automation.redo}
            >
              <Redo2 strokeWidth={1.75} />
            </ControlButton>
          </>
        ) : null
      }
    />
  );
}
