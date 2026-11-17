import { useLayoutEffect, useState, type RefObject } from 'react';

import {
  buildTreeEdges,
  PORT_R,
  type EdgePort,
  type EdgeSegment,
  type TreeBox,
  type TreeEdges,
  type TreeLink,
  type TreeRoute,
} from './tree-edge-geometry.js';

export type { TreeLink, TreeRoute } from './tree-edge-geometry.js';

const EMPTY: TreeEdges = { segments: [], ports: [], routes: [] };

/** Геометрия не изменилась — не трогаем состояние (иначе ResizeObserver на
 *  каждое движение полотна перерисовывал бы все рёбра). Сравнение — не только
 *  геометрия, но и ИДЕНТИЧНОСТЬ (#768): после оптимистичной вставки узел
 *  приходит с `temp-…`, рефетч — с реальным id при том же rect. Старое
 *  сравнение «только d» оставляло прежний ключ, и след/импульс не находили
 *  ребро выбранного узла. */
function unchanged(prev: TreeEdges, next: TreeEdges): boolean {
  return (
    prev.segments.length === next.segments.length &&
    prev.segments.every(
      (segment, index) =>
        segment.key === next.segments[index]?.key && segment.d === next.segments[index]?.d,
    ) &&
    prev.ports.length === next.ports.length &&
    prev.ports.every(
      (port, index) =>
        port.key === next.ports[index]?.key &&
        port.x === next.ports[index]?.x &&
        port.y === next.ports[index]?.y,
    ) &&
    prev.routes.length === next.routes.length &&
    prev.routes.every((route, index) => {
      const other = next.routes[index];
      return (
        route.parent === other?.parent &&
        route.child === other?.child &&
        route.d === other?.d &&
        route.length === other?.length
      );
    })
  );
}

/**
 * Рёбра дерева структуры (#768): замер по фактическим rect узлов
 * (ResizeObserver — рендерятся только раскрытые узлы, рёбра следуют за видимым
 * деревом) и чистая геометрия контура (`lib/tree-edge-geometry.ts`).
 * Канвас масштабируется CSS-transform'ом: rects приходят уже в экранных px
 * масштаба, поэтому дельты делятся на `scale` — SVG живёт в непреобразованном
 * пространстве полотна.
 */
export function useTreeEdges(
  rootRef: RefObject<HTMLDivElement | null>,
  nodeRefs: RefObject<Map<string, HTMLElement>>,
  links: TreeLink[],
  scale = 1,
): { segments: EdgeSegment[]; ports: EdgePort[]; routes: TreeRoute[]; portRadius: number } {
  const [edges, setEdges] = useState<TreeEdges>(EMPTY);

  useLayoutEffect(() => {
    const factor = scale || 1;
    function measure() {
      const root = rootRef.current;
      if (!root) return;
      const box = root.getBoundingClientRect();
      const pos = new Map<string, TreeBox>();
      for (const [id, node] of nodeRefs.current ?? []) {
        const rect = node.getBoundingClientRect();
        pos.set(id, {
          x: (rect.left + rect.width / 2 - box.left) / factor,
          y: (rect.top - box.top) / factor,
          h: rect.height / factor,
        });
      }
      const next = buildTreeEdges(pos, links, factor);
      setEdges((prev) => (unchanged(prev, next) ? prev : next));
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [links, nodeRefs, rootRef, scale]);

  return { ...edges, portRadius: PORT_R };
}
