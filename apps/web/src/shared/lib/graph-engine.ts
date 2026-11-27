import { paint, type Body, type CompanyGraph, type Pulse, type Star } from './graph-paint.js';

export type { CompanyGraph, GraphNode, NodeKind } from './graph-paint.js';

const MAX_NODES = 900;
const SETTLE_TICKS = 300;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Живой граф компании: космос, узлы-данные — звёзды, проекты — планеты.
 * Раскладка оседает один раз и замирает в базовых точках; дальше движение —
 * только гладкие синусоидальные дрейфы, медленное вращение карты, мерцание
 * звёзд, пульсы событий и постоянный рост (никакой физики — нет вибрации).
 * Движение включено ВСЕГДА (#1035): системное «уменьшить движение» портал не
 * гасит — веб ведёт себя как десктопная оболочка. */
export function startGraph(canvas: HTMLCanvasElement, graph: CompanyGraph): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const rand = mulberry32(1971);
  const bodies: Body[] = graph.nodes.map((n) => ({
    ...n,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    bx: 0,
    by: 0,
    phase: rand() * Math.PI * 2,
    speed: 0.00025 + rand() * 0.0003,
    amp: 8 + rand() * 10,
    birth: 0,
  }));
  const edges: Array<[number, number]> = [...graph.edges];
  const pulses: Pulse[] = [];
  const stars: Star[] = Array.from({ length: 320 }, () => ({
    x: rand(),
    y: rand(),
    r: 0.4 + rand() * 0.9,
    phase: rand() * Math.PI * 2,
    speed: 0.0004 + rand() * 0.0006,
  }));

  let w = 0;
  let h = 0;
  let raf = 0;
  let frozen = false;
  let lastPulse = 0;
  let lastGrow = 0;
  let px = 0;
  let py = 0;
  let tx = 0;
  let ty = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const seedPositions = () => {
    for (const b of bodies) {
      b.x = w * (0.06 + rand() * 0.88);
      b.y = h * (0.1 + rand() * 0.8);
    }
  };

  const tick = () => {
    const n = bodies.length;
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      if (!a) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        if (!b) continue;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          d2 = 1;
        }
        if (d2 > 40000) continue;
        const f = 950 / d2;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
    }
    for (const [i, j] of edges) {
      const a = bodies[i];
      const b = bodies[j];
      if (!a || !b) continue;
      const rest = a.kind === 'satellite' || b.kind === 'satellite' ? 26 : 95;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = ((d - rest) / d) * 0.015;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    for (const b of bodies) {
      b.vx += (w / 2 - b.x) * 0.0006;
      b.vy += (h / 2 - b.y) * 0.0016;
      b.vx *= 0.86;
      b.vy *= 0.86;
      b.x += b.vx;
      b.y += b.vy;
    }
  };

  const freeze = () => {
    frozen = true;
    for (const b of bodies) {
      b.bx = b.x;
      b.by = b.y;
    }
  };

  const grow = (t: number) => {
    if (bodies.length >= MAX_NODES) return;
    const real = bodies.filter((b) => b.kind !== 'satellite');
    const parent = real[Math.floor(rand() * real.length)];
    if (!parent) return;
    const angle = rand() * Math.PI * 2;
    const dist = 28 + rand() * 32;
    const child: Body = {
      kind: 'satellite',
      r: 0.9 + rand() * 0.9,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      bx: parent.bx + Math.cos(angle) * dist,
      by: parent.by + Math.sin(angle) * dist,
      phase: rand() * Math.PI * 2,
      speed: 0.00025 + rand() * 0.0003,
      amp: 5 + rand() * 7,
      birth: t,
    };
    edges.push([bodies.indexOf(parent), bodies.length]);
    bodies.push(child);
    pulses.push({ i: bodies.length - 1, t0: t });
  };

  const frame = (t: number) => {
    px += (tx - px) * 0.02;
    py += (ty - py) * 0.02;

    if (t - lastPulse > 3000) {
      lastPulse = t;
      const real = bodies.filter((b) => b.kind !== 'satellite');
      const b = real[Math.floor(rand() * real.length)];
      if (b) pulses.push({ i: bodies.indexOf(b), t0: t });
    }
    if (t - lastGrow > 3500) {
      lastGrow = t;
      grow(t);
    }

    paint(ctx, { bodies, edges, pulses, stars, w, h, frozen, px, py }, t);
    raf = requestAnimationFrame(frame);
  };

  resize();
  const preplaced = graph.nodes.every((n) => n.nx !== undefined && n.ny !== undefined);
  if (preplaced) {
    graph.nodes.forEach((n, i) => {
      const b = bodies[i];
      if (b) {
        b.x = (n.nx ?? 0.5) * w;
        b.y = (n.ny ?? 0.5) * h;
      }
    });
    freeze();
  } else {
    seedPositions();
    for (let i = 0; i < SETTLE_TICKS; i++) tick();
    freeze();
  }

  raf = requestAnimationFrame(frame);

  const onResize = () => resize();
  const onMove = (event: MouseEvent) => {
    tx = (event.clientX / Math.max(1, w) - 0.5) * 14;
    ty = (event.clientY / Math.max(1, h) - 0.5) * 10;
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMove);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', onMove);
  };
}
