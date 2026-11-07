import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { ProjectNode } from '@nodus/contracts';

import { subtreeNodeIds } from './structure-tree.js';

/** DnD дерева структуры (#467): строки статичны (урок gotchas — живой
 *  реордер строк не делаем), меняется только индикация: линия вставки между
 *  строк + подсветка папки. Зоны четверти: верх = перед узлом, середина =
 *  внутрь, низ = после; НИЗ РАСКРЫТОГО узла = первым ребёнком. Узел нельзя
 *  бросить в себя/потомка — зона гасится. Наведение на свёрнутый узел 700 мс
 *  раскрывает его. */

export type DragPayload = { kind: 'node'; nodeId: string } | { kind: 'tasks'; taskIds: string[] };
export type DropZone = 'before' | 'into' | 'after';

export interface DropTarget {
  /** id droppable-строки (`node:<id>` | 'no-node'). */
  overId: string;
  zone: DropZone;
  /** Блок цикла: подсветка гаснет, дроп игнорируется. */
  invalid: boolean;
}

export const NO_NODE_DROP_ID = 'no-node';

/** Место вставки узла по зоне (родитель + якорь) — общая логика индикации и
 *  дропа; null = нельзя (цикл). */
export function nodeDropPlacement(
  nodes: ProjectNode[],
  draggingId: string,
  overId: string,
  zone: DropZone,
  expanded: (id: string) => boolean,
): { parentId: string | null; beforeId?: string; afterId?: string } | null {
  const overNodeId = overId.slice('node:'.length);
  const over = nodes.find((n) => n.id === overNodeId);
  if (!over) return null;
  let parentId: string | null;
  let beforeId: string | undefined;
  let afterId: string | undefined;
  if (zone === 'into') {
    parentId = over.id;
  } else if (zone === 'before') {
    parentId = over.parentId;
    beforeId = over.id;
  } else {
    // Низ раскрытого узла = первым ребёнком; свёрнутого/листа = после узла.
    if (expanded(over.id)) {
      parentId = over.id;
      beforeId = nodes.find((n) => n.parentId === over.id)?.id;
    } else {
      parentId = over.parentId;
      afterId = over.id;
    }
  }
  if (parentId === draggingId) return null;
  if (parentId !== null && subtreeNodeIds(nodes, draggingId).has(parentId)) return null;
  // Якорь не может быть самим переносимым узлом: дроп на собственную строку
  // (before/after) или первым ребёнком раскрытого родителя дал бы серверу
  // beforeId/afterId === draggingId и безобидное действие падало бы 422.
  if (beforeId === draggingId || afterId === draggingId) return null;
  return { parentId, beforeId, afterId };
}

function zoneOf(y: number, top: number, height: number): DropZone {
  const rel = (y - top) / Math.max(height, 1);
  if (rel < 0.25) return 'before';
  if (rel > 0.75) return 'after';
  return 'into';
}

export interface StructureDnd {
  context: React.ComponentProps<typeof DndContext>;
  active: DragPayload | null;
  dropTarget: DropTarget | null;
}

export function useStructureDnd({
  nodes,
  expanded,
  expand,
  onDropNode,
  onDropTasks,
}: {
  nodes: ProjectNode[];
  /** Узел раскрыт (для «низ = первым ребёнком»). */
  expanded: (id: string) => boolean;
  /** Раскрыть узел (авто-раскрытие при наведении 700 мс). */
  expand: (id: string) => void;
  onDropNode: (
    nodeId: string,
    parentId: string | null,
    beforeId?: string,
    afterId?: string,
  ) => void;
  onDropTasks: (taskIds: string[], nodeId: string | null) => void;
}): StructureDnd {
  const [active, setActive] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const expandTimer = useRef<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const activeRef = useRef<DragPayload | null>(null);
  activeRef.current = active;
  const targetRef = useRef<DropTarget | null>(null);
  targetRef.current = dropTarget;

  const clearTimer = useCallback(() => {
    if (expandTimer.current !== null) {
      window.clearTimeout(expandTimer.current);
      expandTimer.current = null;
    }
  }, []);

  /** Таймер авто-раскрытия не переживает хук (A6-8): уход со вкладки во
   *  время наведения оставлял setTimeout, который дёргал `expand` на
   *  размонтированном дереве. */
  useEffect(() => clearTimer, [clearTimer]);

  /**
   * Публикация цели дропа (A6-5): `onDragMove` приходит на КАЖДЫЙ mousemove,
   * а зона меняется в разы реже. Новый объект в state перерисовывал всё
   * дерево структуры 60 раз в секунду — сетим, только когда сменились
   * адрес/зона/запрет. Ref обновляется сразу: сравнение не ждёт рендера.
   */
  const commitTarget = useCallback((next: DropTarget | null) => {
    const prev = targetRef.current;
    if (prev === next) return;
    if (
      prev &&
      next &&
      prev.overId === next.overId &&
      prev.zone === next.zone &&
      prev.invalid === next.invalid
    ) {
      return;
    }
    targetRef.current = next;
    setDropTarget(next);
  }, []);

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActive((event.active.data.current as DragPayload | undefined) ?? null);
  }, []);

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const payload = activeRef.current;
      const overId = event.over?.id ? String(event.over.id) : null;
      if (!payload || !overId) {
        clearTimer();
        commitTarget(null);
        return;
      }
      // Позиция курсора: активатор + накопленное смещение (строки статичны).
      const activator = event.activatorEvent as PointerEvent | KeyboardEvent;
      const baseY = 'clientY' in activator ? activator.clientY : 0;
      const rect = event.over?.rect;
      if (!rect) {
        clearTimer();
        commitTarget(null);
        return;
      }
      const zone =
        payload.kind === 'tasks' && overId !== NO_NODE_DROP_ID
          ? 'into'
          : zoneOf(baseY + event.delta.y, rect.top, rect.height);

      let target: DropTarget | null = { overId, zone, invalid: false };
      if (payload.kind === 'node') {
        if (overId === NO_NODE_DROP_ID) {
          target = null; // узел в «Без узла» не бросается
        } else {
          target = {
            overId,
            zone,
            invalid: nodeDropPlacement(nodes, payload.nodeId, overId, zone, expanded) === null,
          };
        }
      }
      commitTarget(target);

      // Авто-раскрытие свёрнутой папки при наведении 700 мс.
      clearTimer();
      if (target && !target.invalid && overId.startsWith('node:')) {
        const nodeId = overId.slice('node:'.length);
        const node = nodes.find((n) => n.id === nodeId);
        if (node && node.id !== (payload.kind === 'node' ? payload.nodeId : '')) {
          expandTimer.current = window.setTimeout(() => expand(nodeId), 700);
        }
      }
    },
    [clearTimer, commitTarget, expand, expanded, nodes],
  );

  const finish = useCallback(() => {
    clearTimer();
    setActive(null);
    targetRef.current = null;
    setDropTarget(null);
  }, [clearTimer]);

  const onDragEnd = useCallback(() => {
    const payload = activeRef.current;
    const target = targetRef.current;
    finish();
    if (!payload || !target || target.invalid) return;
    if (payload.kind === 'tasks') {
      if (target.overId === NO_NODE_DROP_ID) onDropTasks(payload.taskIds, null);
      else onDropTasks(payload.taskIds, target.overId.slice('node:'.length));
      return;
    }
    if (target.overId === NO_NODE_DROP_ID) return;
    const placement = nodeDropPlacement(
      nodes,
      payload.nodeId,
      target.overId,
      target.zone,
      expanded,
    );
    if (placement) {
      onDropNode(payload.nodeId, placement.parentId, placement.beforeId, placement.afterId);
    }
  }, [expanded, finish, nodes, onDropNode, onDropTasks]);

  return {
    context: {
      sensors,
      onDragStart,
      onDragMove,
      onDragEnd,
      onDragCancel: finish,
    },
    active,
    dropTarget,
  };
}
