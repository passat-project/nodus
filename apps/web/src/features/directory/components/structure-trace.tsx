import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { edgeDurations } from '@nodus/ui/components/node-edge';

import type { DepartmentLink } from '../lib/department-tree.js';
import { planTrace } from '../lib/trace-plan.js';
import type { TreeRoute } from '../lib/use-tree-edges.js';

interface TraceSegment {
  key: string;
  d: string;
  length: number;
}

const EMPTY_SEGMENTS: TraceSegment[] = [];
const EMPTY_TRAIL: readonly DepartmentLink[] = [];

/** Бюджет пробега ВСЕГО нового хвоста, сек (#973): на широкой ступени рёбра
 *  доходят до 3–5 тыс. px, и канонная скорость 1200 px/s давала 2.5–4 с
 *  ожидания (при зуме < 100% длины в координатах полотна ещё больше). */
const TRACE_MAX_S = 0.8;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * След спуска по структуре (#768, пакет 16.11.2026): от главной карточки к
 * выбранному отделу бежит точка-импульс и закрашивает за собой линию.
 *
 * Скорость — канон `edgeDurations().draw` (1200 px/s, минимум 0.15 с), как у
 * импульса модулей; но весь НОВЫЙ хвост укладывается в бюджет `TRACE_MAX_S`
 * (0,8 с) — длинные рёбра ужимаются пропорционально, относительные скорости
 * сохраняются (#973). Точка и закрашиваемая часть линии ведутся ОДНИМ
 * прогрессом на кадре — отдельных скоростей/таймеров нет.
 *
 * Маршруты сравниваются: общий префикс уже закрашен и заново не проходится,
 * точка появляется у карточки расхождения (нижний порт — конец префикса) и
 * бежит только новый хвост (`lib/trace-plan.ts`). Выбран предок — точка не
 * бежит, остаётся закрашенный префикс; соседняя ветка/первый показ — от
 * верхней карточки. След остаётся до смены выбора.
 *
 * SMIL здесь НЕ используется сознательно: `<animateMotion>` считает время от
 * загрузки документа, поэтому вставленный позже «уже закончился» — точка
 * замирает в конце маршрута (gotcha frontend). Анимация — rAF по измеренным
 * рёбрам (`useTreeEdges`), координаты — `getPointAtLength` по тому же path,
 * что и закрашенная линия. Среды без SVG-геометрии (jsdom) — след
 * закрашивается сразу, без пробега; системное «уменьшить движение» пробег НЕ
 * гасит (#1035): веб ведёт себя как десктопная оболочка.
 */
export function StructureTrace({
  routes,
  trail,
  runKey,
}: {
  routes: readonly TreeRoute[];
  trail: readonly DepartmentLink[];
  /** Новый ключ = новый пробег (смена выбора, повторный выбор из поиска). */
  runKey: string;
}) {
  const segments = useMemo(() => {
    if (trail.length === 0) return EMPTY_SEGMENTS;
    const byLink = new Map(routes.map((route) => [`${route.parent}:${route.child}`, route]));
    const list: TraceSegment[] = [];
    for (const link of trail) {
      const route = byLink.get(`${link.parent}:${link.child}`);
      // Геометрия ещё не измерена — ждём полный маршрут, половину не красим.
      if (!route) return EMPTY_SEGMENTS;
      list.push({ key: `${link.parent}:${link.child}`, d: route.d, length: route.length });
    }
    return list;
  }, [routes, trail]);

  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const dotRef = useRef<SVGCircleElement>(null);
  const startedKey = useRef<string | null>(null);
  const rafRef = useRef(0);
  /** Маршрут прошлого выбора — база для общего закрашенного префикса. */
  const previousTrail = useRef<readonly DepartmentLink[]>(EMPTY_TRAIL);
  /** План пробега — одна выдача на маршрут (StrictMode-повторный setup берёт
   *  сохранённый план, иначе маршрут счёл бы себя уже пройденным). */
  const runRef = useRef<{ key: string; plan: ReturnType<typeof planTrace> } | null>(null);

  // Размонтирование — гасим кадровый цикл (смена runKey гасит его в эффекте).
  // startedKey сбрасываем: StrictMode прогоняет cleanup/setup дважды, и без
  // сброса повторный setup счёл бы пробег «уже запущенным» и не оживил его.
  useEffect(
    () => () => {
      window.cancelAnimationFrame(rafRef.current);
      startedKey.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    if (trail.length === 0) {
      window.cancelAnimationFrame(rafRef.current);
      startedKey.current = null;
      previousTrail.current = EMPTY_TRAIL;
      runRef.current = null;
      return;
    }
    if (segments.length === 0) {
      window.cancelAnimationFrame(rafRef.current);
      startedKey.current = null;
      return;
    }
    if (startedKey.current === runKey) return;

    window.cancelAnimationFrame(rafRef.current);
    startedKey.current = runKey;

    if (runRef.current?.key !== runKey) {
      runRef.current = { key: runKey, plan: planTrace(previousTrail.current, trail) };
      previousTrail.current = trail;
    }
    const plan = runRef.current.plan;
    const paintedCount = Math.min(plan.painted, segments.length);

    const paths = segments.map((segment) => pathRefs.current.get(segment.key) ?? null);
    const dot = dotRef.current;
    const paintAll = () => {
      for (const path of paths) if (path) path.style.strokeDashoffset = '0';
      if (dot) dot.style.opacity = '0';
    };
    const canAnimate =
      typeof window.requestAnimationFrame === 'function' &&
      paths.every((path) => path !== null && typeof path.getPointAtLength === 'function');

    // Общий префикс — уже закрашен; новый хвост стартует с нуля.
    for (let index = 0; index < paintedCount; index += 1) {
      const path = paths[index];
      if (path) path.style.strokeDashoffset = '0';
    }
    for (let index = paintedCount; index < segments.length; index += 1) {
      const path = paths[index];
      if (path) path.style.strokeDashoffset = '1';
    }
    if (!canAnimate || !plan.animate) {
      paintAll();
      return;
    }

    if (dot) dot.style.opacity = '0';
    const tail = segments.slice(paintedCount);
    // Канонная скорость рёбер (`edgeDurations` — 1200 px/s, минимум 0.15 с),
    // но суммарный пробег хвоста ограничен бюджетом: длинные рёбра ужимаются
    // ПРОПОРЦИОНАЛЬНО, поэтому относительные скорости сохраняются, а точка и
    // линия по-прежнему ведутся одним прогрессом (#973).
    const baseDurations = tail.map((segment) => edgeDurations(segment.length).draw);
    const baseTotal = baseDurations.reduce((sum, duration) => sum + duration, 0);
    const scale = baseTotal > TRACE_MAX_S ? TRACE_MAX_S / baseTotal : 1;
    const durations = baseDurations.map((duration) => duration * scale);
    const delays: number[] = [];
    let total = 0;
    for (const duration of durations) {
      delays.push(total);
      total += duration;
    }

    const startedAt = performance.now();
    const frame = (now: number) => {
      const elapsed = (now - startedAt) / 1000;
      let current = -1;
      for (let index = 0; index < tail.length; index += 1) {
        const duration = durations[index]!;
        const delay = delays[index]!;
        const progress = clamp01((elapsed - delay) / duration);
        const path = paths[paintedCount + index];
        if (path) path.style.strokeDashoffset = String(1 - progress);
        if (elapsed >= delay && elapsed < delay + duration) current = index;
      }
      // Точка и линия — один прогресс на кадре: позиция точки = конец
      // закрашенной части текущего ребра.
      if (current >= 0 && dot) {
        const segment = tail[current]!;
        const path = paths[paintedCount + current];
        if (path) {
          const progress = clamp01((elapsed - delays[current]!) / durations[current]!);
          const point = path.getPointAtLength(progress * segment.length);
          dot.setAttribute('cx', String(point.x));
          dot.setAttribute('cy', String(point.y));
          dot.style.opacity = '1';
        }
      }
      if (elapsed >= total) {
        paintAll();
        return;
      }
      rafRef.current = window.requestAnimationFrame(frame);
    };
    rafRef.current = window.requestAnimationFrame(frame);
  }, [runKey, segments, trail]);

  if (segments.length === 0) return null;

  return (
    <g data-structure-trace>
      {segments.map((segment) => (
        <path
          key={segment.key}
          ref={(element) => {
            if (element) pathRefs.current.set(segment.key, element);
            else pathRefs.current.delete(segment.key);
          }}
          data-trace-edge={segment.key}
          d={segment.d}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1}
          pathLength={1}
          style={{ strokeDasharray: 1, filter: 'drop-shadow(0 0 6px var(--glow))' }}
        />
      ))}
      <circle
        ref={dotRef}
        data-trace-dot
        r={2.5}
        cx={0}
        cy={0}
        fill="var(--port)"
        style={{ opacity: 0 }}
      />
    </g>
  );
}
