import type { Edge, Node } from '@xyflow/react';
import type { WorkflowDraftDocument } from '@nodus/contracts';

import type { AnyFlowNode } from './any-node.js';
import { ARROW_MARKER, ARROW_MARKER_SELECTED } from './flow-markers.js';
import { U_BASE, anyNodeId, resolveRoute, startBoxOf } from './route-resolve.js';
import type { StartFlowNode } from './start-node.js';
import type { StatusFlowNode } from './status-node.js';
import type { TransitionFlowEdge } from './transition-edge.js';

export { anyNodeId, transitionOfAnyNode } from './route-resolve.js';

/**
 * Сборка графа холста из документа маршрута (#378 ред. 2, ADR-0022):
 * раскладка — `resolveRoute` (общая расстановка документа, иначе авто),
 * здесь — узлы и рёбра React Flow: статусы с кружками точек подключения,
 * метки «Любой статус» со стрелкой в статус, старт на линии начального
 * статуса. Чистая: редактор и «Схема маршрута» получают одинаковый результат.
 */

export const START_NODE_ID = 'route-start';
export const START_EDGE_ID = 'route-start-edge';
const START_TARGET = 'l2';

export interface RouteGraphOptions {
  readOnly: boolean;
  /** Бейдж проблемы на статусе (id статуса). */
  problemStageIds?: ReadonlySet<string>;
  /** Подсветка текущего статуса задачи («Схема маршрута»). */
  currentStageId?: string | null;
  /** Кнопки, доступные текущему пользователю (выделены в «Схеме маршрута»). */
  highlightedTransitionIds?: ReadonlySet<string>;
  /** Счётчики задач по статусам (редактор). */
  stageEntityCounts?: Readonly<Record<string, number>>;
  /** Выделение редактора (кольцо узла, подсветка стрелки и её подписи);
   *  `creation` — выделен узел «Создание» (#432). */
  selection?: { kind: 'stage' | 'transition' | 'action' | 'creation'; id: string } | null;
  onSelectTransition?: (id: string) => void;
  /** Подпись перетащили вдоль стрелки (только редактор). */
  onLabelT?: (transitionId: string, t: number) => void;
  /** Свободный участок стрелки отодвинули (только редактор). */
  onBend?: (transitionId: string, param: 'shift' | 'offset', value: number | null) => void;
}

export function buildRouteGraph(
  doc: WorkflowDraftDocument,
  options: RouteGraphOptions,
): { nodes: Node[]; edges: Edge[] } {
  const route = resolveRoute(doc);
  const readOnly = options.readOnly;
  const isSelected = (kind: 'stage' | 'transition', id: string) =>
    options.selection?.kind === kind && options.selection.id === id;
  const initial = doc.stages.find((s) => s.isInitial);

  // Действия (#633) — у статуса на холсте только бейдж со счётчиком:
  // статус они не меняют, стрелки у них нет. Действия «в любом статусе»
  // доступны и здесь — считаем их вместе со своими (свои первыми).
  const actions = [...(doc.actions ?? [])].sort(
    (a, b) => Number(a.stageId === null) - Number(b.stageId === null) || a.sortOrder - b.sortOrder,
  );
  const stageActionList = (stageId: string) =>
    actions
      .filter((a) => a.stageId === null || a.stageId === stageId)
      .map((a) => ({ id: a.id, name: a.name }));
  const selectedAction =
    options.selection?.kind === 'action'
      ? (actions.find((a) => a.id === options.selection!.id) ?? null)
      : null;
  const selectedActionStageId = selectedAction?.stageId ?? null;

  // Занятые точки подключения статусов — кружки, к которым приходят стрелки.
  const ports = new Map<string, Set<string>>();
  const markPort = (nodeId: string, handle: string) =>
    ports.set(nodeId, (ports.get(nodeId) ?? new Set()).add(handle));
  for (const input of route.inputs) {
    const h = route.handles.get(input.id);
    if (!h) continue;
    markPort(input.source, h.sourceHandle);
    markPort(input.target, h.targetHandle);
  }
  if (initial) markPort(initial.id, START_TARGET);

  // Точки на концах выделенной стрелки — подсвечиваются на узлах.
  const selectedPorts = new Map<string, string[]>();
  const selectedInput =
    options.selection?.kind === 'transition'
      ? route.inputs.find((i) => i.id === options.selection!.id)
      : undefined;
  const selectedHandles = selectedInput ? route.handles.get(selectedInput.id) : undefined;
  if (selectedInput && selectedHandles) {
    selectedPorts.set(selectedInput.source, [selectedHandles.sourceHandle]);
    selectedPorts.set(selectedInput.target, [
      ...(selectedPorts.get(selectedInput.target) ?? []),
      selectedHandles.targetHandle,
    ]);
  }

  const nodes: Node[] = doc.stages.map(
    (stage) =>
      ({
        id: stage.id,
        type: 'status',
        position: route.positions.get(stage.id)!,
        selected: isSelected('stage', stage.id) || selectedActionStageId === stage.id,
        draggable: !readOnly,
        connectable: !readOnly,
        deletable: !readOnly,
        data: {
          name: stage.name,
          color: stage.color,
          systemState: stage.systemState,
          isInitial: stage.isInitial,
          outcome: stage.outcome,
          hasProblem: options.problemStageIds?.has(stage.id) ?? false,
          current: options.currentStageId === stage.id,
          readOnly,
          taskCount: options.stageEntityCounts?.[stage.id] ?? 0,
          actions: stageActionList(stage.id),
          selectedActionId:
            selectedActionStageId === stage.id ? (selectedAction?.id ?? null) : null,
          ports: [...(ports.get(stage.id) ?? [])],
          selectedPorts: selectedPorts.get(stage.id) ?? [],
        },
      }) satisfies StatusFlowNode,
  );

  for (const [transitionId, anchor] of route.anchors) {
    const id = anyNodeId(transitionId);
    nodes.push({
      id,
      type: 'any',
      position: anchor,
      selected: isSelected('transition', transitionId),
      draggable: !readOnly,
      connectable: false,
      deletable: !readOnly,
      data: {
        transitionId,
        readOnly,
        port: [...(ports.get(id) ?? [])][0] ?? null,
        portSelected: selectedPorts.has(id),
      },
    } satisfies AnyFlowNode);
  }

  const byId = new Map(doc.transitions.map((t) => [t.id, t]));
  const edges: TransitionFlowEdge[] = [];
  for (const input of route.inputs) {
    const t = byId.get(input.id)!;
    const h = route.handles.get(t.id);
    if (!h) continue;
    const selected = isSelected('transition', t.id);
    const { offset, shift } = route.spread.get(t.id) ?? { offset: U_BASE, shift: 0 };
    edges.push({
      id: t.id,
      type: 'transition',
      source: input.source,
      target: t.toStageId,
      sourceHandle: h.sourceHandle,
      targetHandle: h.targetHandle,
      selected,
      deletable: !readOnly,
      reconnectable: readOnly ? false : t.fromStageId === null ? 'target' : true,
      markerEnd: selected ? ARROW_MARKER_SELECTED : ARROW_MARKER,
      data: {
        name: t.name,
        display: t.display,
        labelT: route.labels.get(t.id) ?? 0.5,
        offset,
        shift,
        dim: options.highlightedTransitionIds ? !options.highlightedTransitionIds.has(t.id) : false,
        onSelect: options.onSelectTransition ? () => options.onSelectTransition!(t.id) : undefined,
        onLabelT: options.onLabelT ? (value) => options.onLabelT!(t.id, value) : undefined,
        onBend: options.onBend ? (param, value) => options.onBend!(t.id, param, value) : undefined,
      },
    });
  }
  // Выделенная стрелка — последней: поверх соседних линий, но ПОД слоем
  // подписей (z-index ребра не поднимаем — иначе линия перечёркивала чипы).
  edges.sort((a, b) => Number(a.selected) - Number(b.selected));

  // Старт «Создание задачи»: центр на линии центра начального — стрелка прямая.
  if (initial) {
    const box = startBoxOf(route.positions.get(initial.id)!);
    nodes.push({
      id: START_NODE_ID,
      type: 'start',
      position: { x: box.x, y: box.y },
      draggable: false,
      selectable: false,
      deletable: false,
      connectable: !readOnly,
      // Форма создания (#432): узел «Создание» выделяется как элемент холста.
      data: { readOnly, selected: options.selection?.kind === 'creation' },
    } satisfies StartFlowNode);
    edges.push({
      id: START_EDGE_ID,
      type: 'transition',
      source: START_NODE_ID,
      sourceHandle: 'r',
      target: initial.id,
      targetHandle: START_TARGET,
      selectable: false,
      deletable: false,
      reconnectable: readOnly ? false : 'target',
      markerEnd: ARROW_MARKER,
      data: { name: '', display: 'button', labelT: 0.5, offset: U_BASE, shift: 0 },
    });
  }

  return { nodes, edges };
}
