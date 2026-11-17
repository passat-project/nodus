import { orthPath } from '@nodus/ui/components/node-edge';

import { uiPx } from '../../../shared/ui/ui-scale.js';

/** Отступ конца отвода от края порта (порт r=3 закрывает конец линии). */
export const PORT_GAP = 4;
/** Радиус порта на целевом конце линии. */
export const PORT_R = 3;

/** Единый радиус локтя всех связей структуры (вердикт владельца 17.11.2026:
 *  «8 везде» — как крайние повороты контура модулей). Дизайн-px: полотно живёт
 *  в rem-масштабе интерфейса вместе с карточками. */
const ELBOW = uiPx(8);

/** Карточка на полотне: центр по X, верх и высота. */
export interface TreeBox {
  x: number;
  y: number;
  h: number;
}

export interface TreeLink {
  parent: string;
  child: string;
}

export interface EdgeSegment {
  key: string;
  d: string;
}

export interface EdgePort {
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

export interface TreeEdges {
  segments: EdgeSegment[];
  ports: EdgePort[];
  routes: TreeRoute[];
}

/** Длина локтя-квадратики радиуса r — четверть оборота от вертикали к
 *  горизонтали (точный интеграл 1.6232·r; 8 отрезков дают ошибку < 0.1%).
 *  Импульс идёт по дуге, а не по хорде — скорость считается по ней. */
export function elbowLength(r: number): number {
  let length = 0;
  let prevX = 0;
  let prevY = r;
  for (let i = 1; i <= 8; i += 1) {
    const t = i / 8;
    const u = 1 - t;
    const x = r * t * t;
    const y = r * u * u;
    length += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return length;
}

/**
 * Привязка координаты полотна к полупикселю УСТРОЙСТВА с учётом зума: полотно
 * масштабируется CSS-transform'ом (`scale(zoom)` + округлённый до устройства
 * сдвиг), поэтому снапить надо экранную координату `v·zoom·DPR`, а не
 * координату полотна. Без учёта зума на дробных масштабах (49/143/172%) штрих
 * ложится между пикселями устройства и «плавает» относительно вертикальной оси
 * карточки. При зуме 100% результат прежний (снап `snapPx`).
 */
function snapBoard(value: number, zoom: number): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const scale = (zoom || 1) * dpr;
  return (Math.round(value * scale - 0.5) + 0.5) / scale;
}

interface Kid {
  id: string;
  /** Центр по X (снапнутый). */
  x: number;
  top: number;
  endY: number;
  /** Радиус локтя отвода к этому ребёнку (ужимается свободным местом). */
  radius: number;
}

/** Начало дуги отвода на шине — со стороны ствола. */
function anchorX(kid: Kid, trunkX: number): number {
  return kid.x + (kid.x > trunkX ? -kid.radius : kid.radius);
}

/**
 * Отвод от шины со скруглённым стыком: дуга начинается КАСАТЕЛЬНО на шине (в
 * точке x − r при подходе слева или x + r при подходе справа) и переходит в
 * вертикаль к порту. Вход касательный — стык в одну точку, наложения штрихов
 * нет (они дали бы градиент яркости из сложения полупрозрачных stroke).
 * `fromLeft` — шина приходит слева (ствол слева от отвода), иначе зеркально.
 */
function branchPath(x: number, busY: number, fromLeft: boolean, endY: number, r: number): string {
  const dir = endY >= busY ? 1 : -1;
  return `M ${x + (fromLeft ? -r : r)} ${busY} Q ${x} ${busY} ${x} ${busY + dir * r} L ${x} ${endY}`;
}

/**
 * Геометрия рёбер дерева по грамматике контура Nodus (вынуто из OrgChart, #84;
 * локти скруглены — канон `nodus-ui-style` и вердикты владельца 17.11.2026):
 * на группу «узел → дети» рисуются НЕпересекающиеся пути — шина (горизонталь
 * между детьми), ствол (вертикаль узла) и отводы (вертикали к портам детей);
 * единственный ребёнок ровно под узлом — одна вертикаль. Все локти — радиус 8.
 *
 * Стык ствола с шиной — НЕ тройник: шина с обеих сторон заворачивает ВВЕРХ
 * двумя радиусами и сливается с вертикалью над шиной, под стволом горизонтали
 * нет. При нечётном числе детей вертикаль продолжается в центральную карточку
 * (это её отвод, отдельного сегмента нет); при чётном — заканчивается в
 * вершине дуг. Если все дети с одной стороны, слияния нет: ствол поворачивает
 * в шину одним локтём. Маршрут импульса повторяет ровно эту линию (в вершине
 * дуг разворота нет — ствол и дуга касательны).
 *
 * Каждый сегмент — ровно один штрих (gotchas SVG-графа): дуги входят в линии
 * касательно, концы шины совпадают с началами дуг крайних отводов (хвостов за
 * поворотом нет). Координаты — snapBoard: снап к сетке устройства с учётом
 * зума полотна; rects приходят в экранных px и делятся на масштаб до вызова.
 */
export function buildTreeEdges(
  pos: ReadonlyMap<string, TreeBox>,
  links: readonly TreeLink[],
  zoom = 1,
): TreeEdges {
  const segments: EdgeSegment[] = [];
  const ports: EdgePort[] = [];
  const routes: TreeRoute[] = [];
  const childrenOf = new Map<string, string[]>();
  for (const link of links) {
    const list = childrenOf.get(link.parent) ?? [];
    list.push(link.child);
    childrenOf.set(link.parent, list);
  }

  for (const [parentId, childIds] of childrenOf) {
    const from = pos.get(parentId);
    if (!from) continue;
    const kids: Kid[] = childIds.flatMap((id) => {
      const at = pos.get(id);
      return at
        ? [{ id, x: snapBoard(at.x, zoom), top: at.y, endY: at.y - PORT_GAP, radius: 0 }]
        : [];
    });
    if (kids.length === 0) continue;

    const y0 = from.y + from.h;
    const y1 = Math.min(...kids.map((kid) => kid.top));
    const trunkX = snapBoard(from.x, zoom);
    const only = kids.length === 1 ? kids[0] : undefined;
    // Единственный ребёнок ровно под узлом — одна вертикаль без шины.
    if (only && Math.abs(only.x - trunkX) < 1) {
      const d = `M ${trunkX} ${y0} V ${only.endY}`;
      segments.push({ key: `trunk-${parentId}`, d });
      routes.push({ parent: parentId, child: only.id, d, length: Math.abs(only.endY - y0) });
      ports.push({ key: `port-${only.id}`, x: trunkX, y: y1 - 1 });
      continue;
    }

    const busY = snapBoard((y0 + y1) / 2, zoom);
    const middle = kids.find((kid) => kid.x === trunkX);
    const left = kids.filter((kid) => kid.x < trunkX);
    const right = kids.filter((kid) => kid.x > trunkX);
    const sideKids = [...left, ...right];
    const gaps = kids.map((kid) => Math.abs(kid.x - trunkX)).filter((gap) => gap > 0);
    const nearest = gaps.length > 0 ? Math.min(...gaps) : ELBOW * 2;
    // Локоть ужимается свободным местом: половина вертикали ствола (иначе с
    // маршрутом импульса разойдётся радиус) и половина зазора до ближайшего
    // отвода.
    const r = Math.max(1, Math.min(ELBOW, Math.max((busY - y0) / 2, 1), nearest / 2));
    for (const kid of sideKids) {
      // Отвод не может «съесть» свой зазор до ствола: дуга начинается на шине.
      kid.radius = Math.max(
        1,
        Math.min(ELBOW, Math.abs(kid.endY - busY), Math.abs(kid.x - trunkX) - r - 1),
      );
    }
    const merge = left.length > 0 && right.length > 0;
    const mergeY = busY - r;

    if (merge) {
      // Слияние: вертикаль идёт сквозь шину до вершины дуг НАД шиной.
      segments.push({
        key: `trunk-${parentId}`,
        d: `M ${trunkX} ${y0} V ${middle ? middle.endY : mergeY}`,
      });
      if (middle) {
        routes.push({
          parent: parentId,
          child: middle.id,
          d: `M ${trunkX} ${y0} V ${middle.endY}`,
          length: Math.abs(middle.endY - y0),
        });
      }
      // Левая половина шины: горизонталь к стволу и дуга ВВЕРХ в вершину.
      const leftStart = Math.min(...left.map((kid) => anchorX(kid, trunkX)));
      segments.push({
        key: `bus-left-${parentId}`,
        d: `M ${leftStart} ${busY} H ${trunkX - r} Q ${trunkX} ${busY} ${trunkX} ${mergeY}`,
      });
      // Правая половина — зеркально, от вершины вниз на шину и вправо.
      const rightEnd = Math.max(...right.map((kid) => anchorX(kid, trunkX)));
      segments.push({
        key: `bus-right-${parentId}`,
        d: `M ${trunkX} ${mergeY} Q ${trunkX} ${busY} ${trunkX + r} ${busY} H ${rightEnd}`,
      });
      for (const kid of sideKids) {
        const fromLeft = kid.x > trunkX;
        segments.push({
          key: `drop-${kid.id}`,
          d: branchPath(kid.x, busY, fromLeft, kid.endY, kid.radius),
        });
        // Маршрут идёт по нарисованному пути без разворота: вниз стволом,
        // касательно в дугу слияния, на свою половину шины и в отвод.
        const toLeft = kid.x < trunkX;
        const dipX = trunkX + (toLeft ? -r : r);
        const anchor = anchorX(kid, trunkX);
        const d = `M ${trunkX} ${y0} V ${mergeY} Q ${trunkX} ${busY} ${dipX} ${busY} H ${anchor} Q ${kid.x} ${busY} ${kid.x} ${busY + kid.radius} V ${kid.endY}`;
        routes.push({
          parent: parentId,
          child: kid.id,
          d,
          length:
            Math.abs(mergeY - y0) +
            elbowLength(r) +
            Math.abs(anchor - dipX) +
            elbowLength(kid.radius) +
            Math.abs(kid.endY - (busY + kid.radius)),
        });
      }
    } else {
      // Все дети с одной стороны — ствол поворачивает в шину одним локтём.
      const busOnLeft = left.length > 0;
      const cornerX = trunkX + (busOnLeft ? -r : r);
      if (middle) {
        // Сквозная вертикаль к центральному ребёнку + дуга отхода к шине.
        segments.push({ key: `trunk-${parentId}`, d: `M ${trunkX} ${y0} V ${middle.endY}` });
        segments.push({
          key: `bus-corner-${parentId}`,
          d: `M ${cornerX} ${busY} Q ${trunkX} ${busY} ${trunkX} ${busY - r}`,
        });
        routes.push({
          parent: parentId,
          child: middle.id,
          d: `M ${trunkX} ${y0} V ${middle.endY}`,
          length: Math.abs(middle.endY - y0),
        });
      } else {
        segments.push({
          key: `trunk-${parentId}`,
          d: branchPath(trunkX, busY, busOnLeft, y0, r),
        });
      }
      const anchors = sideKids.map((kid) => anchorX(kid, trunkX));
      segments.push({
        key: `bus-${parentId}`,
        d: `M ${Math.min(...anchors, cornerX)} ${busY} H ${Math.max(...anchors, cornerX)}`,
      });
      for (const kid of sideKids) {
        segments.push({
          key: `drop-${kid.id}`,
          d: branchPath(kid.x, busY, kid.x > trunkX, kid.endY, kid.radius),
        });
        const points = [
          { x: trunkX, y: y0 },
          { x: trunkX, y: busY },
          { x: kid.x, y: busY },
          { x: kid.x, y: kid.endY },
        ];
        routes.push({
          parent: parentId,
          child: kid.id,
          d: orthPath(points, r),
          length: polylineLength(points) - 4 * r + 2 * elbowLength(r),
        });
      }
    }

    for (const kid of kids) {
      ports.push({ key: `port-${kid.id}`, x: kid.x, y: kid.top - 1 });
    }
  }

  return { segments, ports, routes };
}

/** Длина ломаной по вершинам (манхэттен — сегменты ортогональные). */
function polylineLength(points: readonly { x: number; y: number }[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
