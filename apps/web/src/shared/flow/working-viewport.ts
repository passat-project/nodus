import type { Rect, Viewport, XYPosition } from '@xyflow/react';

/** Параметры вписывания: отступы — доля стороны холста, масштаб не выше 1. */
export const FIT = { padding: 0.2, maxZoom: 1 } as const;

/**
 * Рабочий масштаб (#857, Д2): ниже подписи узлов не читаются. Маршрут —
 * горизонтальная цепочка, вписывание целиком даёт 0,22–0,44 при высоте графа
 * в 2–18 % холста. При 0,6 владелец принимал прежний полностраничный
 * редактор.
 */
export const WORK_ZOOM_FLOOR = 0.6;

/**
 * Отступ рабочего вида от края холста, px. Рабочему виду не нужны широкие
 * поля — за графом и так не видно конца; поля 0,2 — только у вида «весь граф
 * по центру».
 */
export const WORK_INSET = 32;

/** Нижняя граница масштаба холста: только чтобы «Вписать» показал весь граф
 *  даже длинный; рабочие виды на неё не опускаются. */
export const CANVAS_MIN_ZOOM = 0.1;

/**
 * Рабочий вид графа — одно правило для всех холстов на `FlowCanvas`.
 *
 * `fit` — вид «весь граф по центру» (формула вписывания: padding 0,2, maxZoom 1).
 * Граф влезает в рабочий масштаб — так и стоит целиком. Не влезает — масштаб
 * равен рабочему, и каждая ось — по одному правилу (`workingAxis`): граф
 * влезает по оси — по центру холста; не влезает — НАЧАЛОМ, край графа в
 * `WORK_INSET` от края холста (старт всегда виден, конец уходит за край).
 */
export function workingViewport(
  fit: Viewport,
  bounds: Rect,
  width: number,
  height: number,
): Viewport {
  if (fit.zoom >= WORK_ZOOM_FLOOR) return fit;
  return {
    zoom: WORK_ZOOM_FLOOR,
    x: workingAxis(bounds.x, bounds.width, width),
    y: workingAxis(bounds.y, bounds.height, height),
  };
}

/**
 * Рабочий вид по одной оси — координата `x` или `y` вида. `start` и `size` —
 * начало и размер графа по этой оси в единицах графа, `canvasSize` — размер
 * холста по ней же.
 */
function workingAxis(start: number, size: number, canvasSize: number): number {
  const scaled = size * WORK_ZOOM_FLOOR;
  return scaled > canvasSize
    ? WORK_INSET - start * WORK_ZOOM_FLOOR
    : (canvasSize - scaled) / 2 - start * WORK_ZOOM_FLOOR;
}

/** Узел из стора движка — ровно то, что нужно для границ графа. */
export interface MeasuredNodeLike {
  measured: { width?: number | null; height?: number | null };
  hidden?: boolean;
  internals: {
    positionAbsolute: XYPosition;
    /** Объект, с которым стор принял узел: его позиция — та, что стор знает. */
    userNode?: { position?: XYPosition };
  };
}

/**
 * Границы графа в единицах холста — или `null`, если вписывать рано: стор
 * движка принимает узлы из свойства эффектом, на коммит позже графа, — там ещё
 * прежний граф (при смене типа) или прежние позиции тех же узлов (после
 * «Упорядочить»), либо часть узлов не измерена. Стор совпадает с графом, когда
 * каждый его узел принят с той же позицией, что у узла графа: позиции — то,
 * что меняется при смене графа и раскладки.
 */
export function measuredBounds(
  graph: readonly { id: string; position?: XYPosition }[],
  lookup: ReadonlyMap<string, MeasuredNodeLike>,
): Rect | null {
  if (lookup.size !== graph.length) return null;
  const incoming = new Map(graph.map((node) => [node.id, node]));
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [id, own] of incoming) {
    const node = lookup.get(id);
    const accepted = node?.internals.userNode?.position;
    if (!node || !accepted) return null;
    if (accepted.x !== own.position?.x || accepted.y !== own.position?.y) return null;
    if (node.hidden) continue;
    const { width, height } = node.measured;
    if (!width || !height) return null;
    const { x, y } = node.internals.positionAbsolute;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
  }
  return left === Infinity ? null : { x: left, y: top, width: right - left, height: bottom - top };
}
