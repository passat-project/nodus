import { useEffect, useMemo, useState } from 'react';
import { cn } from '#lib/utils';

export interface NodeEdgePoint {
  x: number;
  y: number;
}

/** H/V-ломаная со скруглением elbow в промежуточных узлах (манхэттенская геометрия). */
export function orthPath(points: NodeEdgePoint[], r: number): string {
  if (points.length < 2) return '';
  const first = points[0];
  if (!first) return '';
  const parts = [`M${first.x},${first.y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (!prev || !curr || !next) continue;
    const dx1 = Math.sign(curr.x - prev.x);
    const dy1 = Math.sign(curr.y - prev.y);
    const dx2 = Math.sign(next.x - curr.x);
    const dy2 = Math.sign(next.y - curr.y);
    const r1 = Math.min(r, Math.hypot(curr.x - prev.x, curr.y - prev.y) / 2);
    const r2 = Math.min(r, Math.hypot(next.x - curr.x, next.y - curr.y) / 2);
    parts.push(`L${curr.x - dx1 * r1},${curr.y - dy1 * r1}`);
    parts.push(`Q${curr.x},${curr.y} ${curr.x + dx2 * r2},${curr.y + dy2 * r2}`);
  }
  const last = points[points.length - 1];
  if (last) parts.push(`L${last.x},${last.y}`);
  return parts.join(' ');
}

/** Привязка координаты линии к полупикселю устройства: 1px-штрих с центром
 * на device+0.5 ложится ровно на один device-пиксель (DPR 1) или симметрично
 * (дробный DPR/зум) — все прямые линии одинаковой яркости и чёткости. Без
 * снапа линия на целой координате «размазывается» на две полупрозрачные
 * полосы и выглядит тусклее соседней на дробной (заметно при зуме ≤ 100%). */
export function snapPx(v: number): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return (Math.round(v * dpr - 0.5) + 0.5) / dpr;
}

/** Длина ломаной в px (сегменты ортогональные — hypot == манхэттен). */
export function pathLength(points: NodeEdgePoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/** Скорости анимаций — px/s: длительность = длина / скорость (одинаковая
 * скорость вспышки на коротких и дальних маршрутах; темп — как у ближних). */
const PULSE_SPEED = 400;
const DRAW_SPEED = 1200;

/** Длительности рисовки и пробега пульса (сек) из длины маршрута: скорость
 * постоянна, caps — верхняя граница для сверхдлинных маршрутов (вспышка
 * треда на широкоформатном мониторе). ЕДИНСТВЕННЫЙ источник формул: обёртки
 * затухания (flashFadeMs) считают из неё, а не дублируют скорости. */
export function edgeDurations(
  len: number,
  caps?: { draw?: number; pulse?: number },
): { draw: number; pulse: number } {
  return {
    draw: Math.min(Math.max(len / DRAW_SPEED, 0.15), caps?.draw ?? Number.POSITIVE_INFINITY),
    pulse: Math.min(Math.max(len / PULSE_SPEED, 0.3), caps?.pulse ?? Number.POSITIVE_INFINITY),
  };
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Ортогональное ребро «инструмента» (реф node-based UI): сегменты под прямыми
 * углами, порты-точки на концах, опциональные отрисовка при появлении (drawOn)
 * и пульс (SMIL, без JS-цикла). Координаты — пиксели позиционируемого
 * контейнера; svg растянут на него (absolute inset-0, overflow visible).
 * Перемонтирование (key) перезапускает одноразовые анимации.
 */
function NodeEdge({
  points,
  pulse = false,
  active = false,
  drawOn = false,
  ports = 'both',
  elbow = 8,
  drawCapS,
  pulseCapS,
  className,
}: {
  points: NodeEdgePoint[];
  /** true — пульс бегает бесконечно; 'once' — один пробег при монтировании. */
  pulse?: boolean | 'once';
  active?: boolean;
  /** Отрисовка линии от начала к концу при монтировании. */
  drawOn?: boolean;
  /** Порты-точки: на обоих концах, только в целевом или без точек. */
  ports?: 'both' | 'end' | 'none';
  elbow?: number;
  /** Верхняя граница длительности рисовки (сек): на длинных маршрутах
   *  скорость растёт — вспышка остаётся читаемой (thread-flash, circuit.md). */
  drawCapS?: number;
  /** Верхняя граница длительности пробега пульса (сек), см. drawCapS. */
  pulseCapS?: number;
  className?: string;
}) {
  const d = useMemo(() => orthPath(points, elbow), [points, elbow]);
  const len = useMemo(() => pathLength(points), [points]);
  const reduced = useReducedMotion();
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return null;
  const animate = drawOn && !reduced;
  // Длительности — из edgeDurations: скорость вспышки одинакова на всех
  // путях; caps — исключение для сверхдлинных маршрутов (широкоформатный
  // монитор: импульс быстрее, но не «теряется»).
  const { draw: drawDur, pulse: pulseDur } = edgeDurations(len, {
    draw: drawCapS,
    pulse: pulseCapS,
  });
  return (
    <svg
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full overflow-visible',
        className,
      )}
    >
      <path
        d={d}
        fill="none"
        stroke={active ? 'var(--foreground)' : 'var(--edge)'}
        strokeWidth={1}
        pathLength={animate ? 1 : undefined}
        className={animate ? 'node-edge-draw' : undefined}
        style={{
          ...(animate ? { animationDuration: `${drawDur}s` } : null),
          ...(active ? { filter: 'drop-shadow(0 0 6px var(--glow))' } : null),
        }}
      />
      {ports !== 'none' &&
        (ports === 'both' ? [start, end] : [end]).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--port)" />
        ))}
      {pulse && !reduced && (
        <circle r={2.5} fill="var(--port)" opacity={0}>
          {/* fill=freeze — после пробега кружок остаётся в конце пути, иначе
              SMIL возвращает его в (0,0): «светящийся пиксель» в левом верхнем
              углу. opacity-гейт — до старта движения кружок невидим. */}
          <animateMotion
            dur={`${pulseDur}s`}
            begin={drawOn ? `${drawDur}s` : '0s'}
            repeatCount={pulse === 'once' ? '1' : 'indefinite'}
            path={d}
            fill="freeze"
          />
          <animate
            attributeName="opacity"
            from="0"
            to="1"
            begin={drawOn ? `${drawDur}s` : '0s'}
            dur="0.01s"
            fill="freeze"
          />
        </circle>
      )}
    </svg>
  );
}

export { NodeEdge };
