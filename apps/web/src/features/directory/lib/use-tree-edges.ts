import { useLayoutEffect, useState, type RefObject } from 'react';

import { snapPx } from '@nodus/ui/components/node-edge';

/** Отступ конца отвода от края порта (порт r=3 закрывает конец линии). */
const PORT_GAP = 4;
const PORT_R = 3;

interface Segment {
  key: string;
  d: string;
}
interface Port {
  key: string;
  x: number;
  y: number;
}

/** Маршрут «родитель → ребёнок» одной линией: по нему при раскрытии бежит
 *  точка-импульс (вердикт 13.11.2026 — как при переключении вкладок модулей). */
export interface TreeRoute {
  parent: string;
  child: string;
  d: string;
  length: number;
}

export interface TreeLink {
  parent: string;
  child: string;
}

/**
 * Ортогональные рёбра дерева по грамматике контура Nodus (вынуто из OrgChart,
 * #84): на группу «узел → дети» рисуются НЕпересекающиеся пути — шина (одна
 * горизонталь от первого ребёнка до последнего), ствол (одна вертикаль узла до
 * шины), отводы (вертикали к портам детей); единственный ребёнок ровно под
 * узлом — одна вертикаль. КАЖДЫЙ СЕГМЕНТ — РОВНО ОДИН ШТИХ (gotchas SVG-графа):
 * наложения дали бы градиент яркости из сложения полупрозрачных stroke.
 * Координаты — snapPx (равномерная яркость hairline на любом зуме); порты r=3
 * только на целевом конце. Замер — по фактическим rect узлов (ResizeObserver):
 * рендерятся только раскрытые узлы, рёбра следуют за видимым деревом.
 * Канвас масштабируется CSS-transform'ом (#768): rects приходят уже в
 * экранных px масштаба, поэтому дельты делятся на `scale` — SVG живёт в
 * непреобразованном пространстве полотна.
 */
export function useTreeEdges(
  rootRef: RefObject<HTMLDivElement | null>,
  nodeRefs: RefObject<Map<string, HTMLElement>>,
  links: TreeLink[],
  scale = 1,
): { segments: Segment[]; ports: Port[]; routes: TreeRoute[]; portRadius: number } {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [ports, setPorts] = useState<Port[]>([]);
  const [routes, setRoutes] = useState<TreeRoute[]>([]);

  useLayoutEffect(() => {
    const factor = scale || 1;
    function measure() {
      const root = rootRef.current;
      if (!root) return;
      const box = root.getBoundingClientRect();
      const pos = new Map<string, { x: number; y: number; h: number }>();
      for (const [id, node] of nodeRefs.current ?? []) {
        const rect = node.getBoundingClientRect();
        pos.set(id, {
          x: (rect.left + rect.width / 2 - box.left) / factor,
          y: (rect.top - box.top) / factor,
          h: rect.height / factor,
        });
      }
      const childrenOf = new Map<string, string[]>();
      for (const link of links) {
        const list = childrenOf.get(link.parent) ?? [];
        list.push(link.child);
        childrenOf.set(link.parent, list);
      }
      const nextSegments: Segment[] = [];
      const nextPorts: Port[] = [];
      const nextRoutes: TreeRoute[] = [];
      for (const [parentId, childIds] of childrenOf) {
        const from = pos.get(parentId);
        const childPos = childIds
          .map((id) => pos.get(id))
          .filter((p): p is { x: number; y: number; h: number } => p !== undefined);
        if (!from || childPos.length === 0) continue;
        const y0 = from.y + from.h;
        const y1 = Math.min(...childPos.map((p) => p.y));
        const trunkX = snapPx(Math.round(from.x));
        const only = childPos.length === 1 ? childPos[0] : undefined;
        if (only && Math.abs(only.x - from.x) < 1) {
          const d = `M ${trunkX} ${y0} V ${y1 - PORT_GAP}`;
          nextSegments.push({ key: `trunk-${parentId}`, d });
          nextRoutes.push({
            parent: parentId,
            child: childIds[0]!,
            d,
            length: Math.abs(y1 - PORT_GAP - y0),
          });
          nextPorts.push({ key: `port-${childIds[0]}`, x: trunkX, y: y1 - 1 });
          continue;
        }
        const busY = snapPx(Math.round((y0 + y1) / 2));
        const xs = childPos.map((p) => Math.round(p.x));
        const firstX = snapPx(Math.min(...xs, Math.round(from.x)));
        const lastX = snapPx(Math.max(...xs, Math.round(from.x)));
        nextSegments.push({ key: `bus-${parentId}`, d: `M ${firstX} ${busY} H ${lastX}` });
        nextSegments.push({ key: `trunk-${parentId}`, d: `M ${trunkX} ${y0} V ${busY}` });
        for (const childId of childIds) {
          const to = pos.get(childId);
          if (!to) continue;
          const x = snapPx(Math.round(to.x));
          const endY = to.y - PORT_GAP;
          nextSegments.push({ key: `drop-${childId}`, d: `M ${x} ${busY} V ${endY}` });
          nextRoutes.push({
            parent: parentId,
            child: childId,
            d: `M ${trunkX} ${y0} V ${busY} H ${x} V ${endY}`,
            length: Math.abs(busY - y0) + Math.abs(x - trunkX) + Math.abs(endY - busY),
          });
          nextPorts.push({ key: `port-${childId}`, x, y: to.y - 1 });
        }
      }
      // Сравнение — не только геометрия, но и ИДЕНТИЧНОСТЬ (#768): после
      // оптимистичной вставки узел приходит с `temp-…`, рефетч — с реальным
      // id при том же rect. Старое сравнение «только d» оставляло прежний
      // ключ, и след/импульс не находили ребро выбранного узла.
      setSegments((prev) =>
        prev.length === nextSegments.length &&
        prev.every((s, i) => s.key === nextSegments[i]?.key && s.d === nextSegments[i]?.d)
          ? prev
          : nextSegments,
      );
      setPorts((prev) =>
        prev.length === nextPorts.length &&
        prev.every(
          (p, i) =>
            p.key === nextPorts[i]?.key && p.x === nextPorts[i]?.x && p.y === nextPorts[i]?.y,
        )
          ? prev
          : nextPorts,
      );
      setRoutes((prev) =>
        prev.length === nextRoutes.length &&
        prev.every(
          (r, i) =>
            r.parent === nextRoutes[i]?.parent &&
            r.child === nextRoutes[i]?.child &&
            r.d === nextRoutes[i]?.d &&
            r.length === nextRoutes[i]?.length,
        )
          ? prev
          : nextRoutes,
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [links, nodeRefs, rootRef, scale]);

  return { segments, ports, routes, portRadius: PORT_R };
}
