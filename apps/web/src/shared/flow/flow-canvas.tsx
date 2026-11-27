import '@xyflow/react/dist/base.css';
import './flow-theme.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  useStore,
  type AriaLabelConfig,
  type Dimensions,
  type EdgeTypes,
  type IsValidConnection,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnect,
  type OnDelete,
  type OnNodeDrag,
  type OnNodesChange,
  type OnReconnect,
  type XYPosition,
} from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { AnyNode } from './any-node.js';
import { FlowAutoFit } from './flow-autofit.js';
import { FlowMarkers } from './flow-markers.js';
import { snapToGuides, type SnapGuide } from './snap-guides.js';
import { StartNode } from './start-node.js';
import { StatusNode } from './status-node.js';
import { TransitionEdge } from './transition-edge.js';
import { CANVAS_MIN_ZOOM, FIT } from './working-viewport.js';

/**
 * Единый движок холста схем (ADR-0022): обёртка React Flow с нашими
 * настройками — потребители (редактор маршрутов, «Схема маршрута», будущая
 * схема проектов) кормят готовые nodes/edges и обрабатывают события.
 * Масштаб, «вписать» и доп. кнопки потребителя (отмена/повтор) — слева
 * внизу, атрибуция — справа внизу с отступом. Просмотр — всё статично.
 * Вид при появлении графа ставит `FlowAutoFit` (рабочий масштаб).
 */
const nodeTypes: NodeTypes = {
  status: StatusNode,
  start: StartNode,
  any: AnyNode,
};
const edgeTypes: EdgeTypes = { transition: TransitionEdge };

const DELETE_KEYS = ['Delete', 'Backspace'];

/** Подписи доступности React Flow — по-русски (I15). */
const ARIA: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default': ui.automation.canvasNodeHint,
  'node.a11yDescription.keyboardDisabled': ui.automation.canvasNodeHint,
  'node.a11yDescription.ariaLiveMessage': ({ x, y }) =>
    `${ui.automation.canvasNodeMoved}: ${Math.round(x)}, ${Math.round(y)}`,
  'edge.a11yDescription.default': ui.automation.canvasEdgeHint,
  'controls.ariaLabel': ui.automation.canvasControls,
  'controls.zoomIn.ariaLabel': ui.automation.zoomIn,
  'controls.zoomOut.ariaLabel': ui.automation.zoomOut,
  'controls.fitView.ariaLabel': ui.automation.fitView,
  'handle.ariaLabel': ui.automation.canvasHandle,
};

export interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onConnect?: OnConnect;
  onReconnect?: OnReconnect;
  isValidConnection?: IsValidConnection;
  onDelete?: OnDelete;
  onNodeDrag?: OnNodeDrag<Node>;
  onNodeDragStop?: OnNodeDrag<Node>;
  onNodeClick?: NodeMouseHandler<Node>;
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
  onPaneClick?: () => void;
  /** Редактор или чтение. */
  interactive: boolean;
  /** Доп. кнопки панели масштаба (отмена/повтор редактора). */
  controls?: React.ReactNode;
  /** Ключ схемы: сменился — вписать заново (смена типа в редакторе). Меняется
   *  В ОДНОМ рендере с узлами — из того же снапшота их источника: ключ
   *  «впереди» узлов вписывал прежний граф под новый тип (#857, Д1). */
  fitKey?: string;
  /** Длительность перехода вида при смене `fitKey`, мс; без неё — сразу. */
  fitDuration?: number;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Размеры узлов, измеренные React Flow, — обратно в объекты узлов
 * (контролируемый режим, наши узлы — производные от документа). Без
 * `measured` каждый новый объект узла (кадр перетаскивания, пересборка графа)
 * считался неизмеренным: React Flow прятал узел и терял его точки
 * подключения до перемера — узлы и стрелки мерцали при перетаскивании, а
 * «узлы измерены» не наступало (холст не вписывался). Объект узла
 * пересоздаётся, только если сменился сам узел или его размер.
 */
function useMeasuredNodes(
  nodes: Node[],
  graphKey: string,
): { nodes: Node[]; onNodesChange: OnNodesChange } {
  const [measured, setMeasured] = useState<ReadonlyMap<string, Dimensions>>(() => new Map());
  // Размеры живут в пределах одного графа. При смене графа узлы новые, кроме
  // стартового с тем же id: с его кэшем узел «Создание» на кадр вставал один
  // на прежнем виде, прежде чем новый граф вписывался (#857, Д1).
  const [owner, setOwner] = useState(graphKey);
  if (owner !== graphKey) {
    setOwner(graphKey);
    setMeasured(new Map());
  }
  const cache = useRef(new WeakMap<Node, { size: Dimensions; node: Node }>());

  const onNodesChange: OnNodesChange = useCallback((changes) => {
    const sizes = changes.flatMap((c) =>
      c.type === 'dimensions' && c.dimensions ? [{ id: c.id, size: c.dimensions }] : [],
    );
    if (sizes.length === 0) return;
    setMeasured((prev) => {
      const fresh = sizes.filter(({ id, size }) => {
        const old = prev.get(id);
        return !old || old.width !== size.width || old.height !== size.height;
      });
      if (fresh.length === 0) return prev;
      const next = new Map(prev);
      for (const { id, size } of fresh) next.set(id, size);
      return next;
    });
  }, []);

  const withSizes = useMemo(
    () =>
      nodes.map((node) => {
        const size = measured.get(node.id);
        if (!size || node.measured) return node;
        const hit = cache.current.get(node);
        if (hit && hit.size === size) return hit.node;
        const next = { ...node, measured: size };
        cache.current.set(node, { size, node: next });
        return next;
      }),
    [nodes, measured],
  );
  return { nodes: withSizes, onNodesChange };
}

/** Экранный порог притяжения направляющих, px. */
const SNAP_PX = 6;
/** Вынос направляющей за крайние узлы, px экрана. */
const GUIDE_OVERHANG = 12;

/**
 * Направляющие выравнивания — волосяная линия 1 device-px (как Figma/tldraw):
 * рисуются в экранных координатах поверх холста, координата округлена к
 * центру пикселя (+0.5) — без размазывания сглаживанием на дробном зуме
 * (в координатах холста линия ложилась между пикселями и выглядела жирной).
 */
function SnapGuideLines({ guides }: { guides: readonly SnapGuide[] }) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  if (guides.length === 0) return null;
  const crisp = (v: number) => Math.round(v) + 0.5;
  const sx = (x: number) => x * zoom + tx;
  const sy = (y: number) => y * zoom + ty;
  return (
    <svg className="flow-snap-guides" aria-hidden>
      {guides.map((g) =>
        g.orientation === 'v' ? (
          <line
            key="v"
            x1={crisp(sx(g.at))}
            x2={crisp(sx(g.at))}
            y1={sy(g.from) - GUIDE_OVERHANG}
            y2={sy(g.to) + GUIDE_OVERHANG}
          />
        ) : (
          <line
            key="h"
            x1={sx(g.from) - GUIDE_OVERHANG}
            x2={sx(g.to) + GUIDE_OVERHANG}
            y1={crisp(sy(g.at))}
            y2={crisp(sy(g.at))}
          />
        ),
      )}
    </svg>
  );
}

/** Текущий масштаб холста — в ref (порог притяжения в единицах холста). */
function ZoomProbe({ zoomRef }: { zoomRef: React.RefObject<number> }) {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom, zoomRef]);
  return null;
}

/**
 * Притяжение перетаскиваемого узла к краям и центрам соседей: потребитель
 * получает уже примагниченную позицию и в кадрах, и на отпускании (React
 * Flow сам отдал бы сырую). Неперетаскиваемые узлы («Создание задачи» едет
 * за начальным статусом) — не ориентиры.
 */
function useSnapDrag(
  nodes: Node[],
  onNodeDrag: OnNodeDrag<Node> | undefined,
  onNodeDragStop: OnNodeDrag<Node> | undefined,
) {
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const zoomRef = useRef(1);
  const last = useRef<{ id: string; position: XYPosition } | null>(null);
  const boxOf = (n: Node) => ({
    x: n.position.x,
    y: n.position.y,
    w: n.measured?.width ?? n.width ?? 0,
    h: n.measured?.height ?? n.height ?? 0,
  });

  const drag: OnNodeDrag<Node> = (event, node, dragged) => {
    const others = nodes
      .filter(
        (n) => n.id !== node.id && n.draggable !== false && !dragged.some((d) => d.id === n.id),
      )
      .map(boxOf)
      .filter((b) => b.w > 0);
    const snap = snapToGuides(
      boxOf(node),
      dragged.length > 1 ? [] : others,
      SNAP_PX / (zoomRef.current || 1),
    );
    const position = { x: snap.x, y: snap.y };
    last.current = { id: node.id, position };
    setGuides(snap.guides);
    onNodeDrag?.(event, { ...node, position }, dragged);
  };

  const stop: OnNodeDrag<Node> = (event, node, dragged) => {
    const position = last.current?.id === node.id ? last.current.position : node.position;
    last.current = null;
    setGuides([]);
    onNodeDragStop?.(event, { ...node, position }, dragged);
  };

  return { guides, zoomRef, onNodeDrag: drag, onNodeDragStop: stop };
}

export function FlowCanvas({
  nodes,
  edges,
  onConnect,
  onReconnect,
  isValidConnection,
  onDelete,
  onNodeDrag,
  onNodeDragStop,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  interactive,
  controls,
  fitKey = '',
  fitDuration = 0,
  className,
  children,
}: FlowCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const measured = useMeasuredNodes(nodes, fitKey);
  const snap = useSnapDrag(measured.nodes, onNodeDrag, onNodeDragStop);
  return (
    <div ref={wrapperRef} className={cn('relative h-full w-full', className)}>
      <FlowMarkers />
      <ReactFlow
        nodes={measured.nodes}
        onNodesChange={measured.onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={onConnect}
        onReconnect={interactive ? onReconnect : undefined}
        isValidConnection={isValidConnection}
        onDelete={onDelete}
        // Delete/Backspace удаляют выделенное, только когда фокус на холсте
        // (или нигде): клавиши в панели, поповерах и диалогах — не удаляют.
        onBeforeDelete={async () => {
          const active = document.activeElement;
          return (
            !active || active === document.body || (wrapperRef.current?.contains(active) ?? false)
          );
        }}
        onNodeDrag={snap.onNodeDrag}
        onNodeDragStop={snap.onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        nodesDraggable={interactive}
        nodesConnectable={interactive}
        edgesReconnectable={interactive}
        reconnectRadius={6}
        elementsSelectable={interactive || onNodeClick !== undefined}
        deleteKeyCode={interactive ? DELETE_KEYS : null}
        nodesFocusable={interactive}
        edgesFocusable={interactive}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={24}
        // Нижняя граница — только для кнопки «Вписать»: длинный маршрут виден
        // целиком; рабочие виды не опускаются ниже `WORK_ZOOM_FLOOR`.
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={1.6}
        attributionPosition="bottom-right"
        ariaLabelConfig={ARIA}
        // Выделение рамкой не нужно: выбор — клик по узлу/ребру.
        selectionOnDrag={false}
        panOnScroll
        zoomOnScroll={false}
        preventScrolling
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} />
        <Controls
          position="bottom-left"
          showInteractive={false}
          fitViewOptions={FIT}
          className="flow-controls"
        >
          {controls}
        </Controls>
        <FlowAutoFit fitKey={fitKey} graph={measured.nodes} duration={fitDuration} />
        <ZoomProbe zoomRef={snap.zoomRef} />
        <SnapGuideLines guides={snap.guides} />
        {children}
      </ReactFlow>
    </div>
  );
}
