/**
 * Генератор фоновой плитки зоны чата (#849): Lucide 1.66 + 6 custom + знак Nodus.
 *
 * Запуск из docs/design/messenger-wallpaper:
 *   node gen-wallpaper.cjs
 *
 * Пишет два готовых ассета (светлая/тёмная тема) в packages/ui/src/assets/.
 * Раскладка — blue-noise: точки расслаблены с учётом радиусов, размер каждой
 * иконки выведен из свободного места (зазоры ровные, наложений нет). Плитка
 * монохромная, цвет и сила запекаются в SVG (background-image не умеет
 * currentColor): светлая — графит 8%, тёмная — светлый граф 6%.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Node-скрипт генератора, CommonJS */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CUSTOM, LUCIDE, NODUS_LOGO } = require('./icon-map.cjs');

const HERE = __dirname;
const LUCIDE_CANDIDATES = [
  path.resolve(HERE, '../../../packages/ui/node_modules/lucide-react/dist/esm/icons'),
  'D:/Project/AI/nodus/packages/ui/node_modules/lucide-react/dist/esm/icons',
];
const OUT_DIR = path.resolve(HERE, '../../../packages/ui/src/assets');

const TILE = 960;
const SEED = 11;
const STROKE = 1.15;

/** Акцент Nodus: фирменные темы (данные, графы, ИИ, автоматизация) и логотип
 *  встречаются чаще офисных/строительных — фон «про Nodus», а не про канцелярию. */
const ACCENT = new Set([
  'nodus', 'neural', 'chip', 'sparkles', 'robot', 'workflow', 'bolt', 'pipeline',
  'layers', 'tree', 'robotArm', 'conveyor', 'plug', 'graph', 'org', 'flow',
  'database', 'server', 'cloud', 'gantt', 'milestone', 'share', 'filter', 'target',
  'bars', 'pie', 'linechart', 'circuitBoard', 'binary', 'gitBranch', 'gitFork',
  'gitMerge', 'serverCog', 'sigma', 'functionSquare', 'scanLine',
]);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function findLucideDir() {
  for (const dir of LUCIDE_CANDIDATES) {
    if (fs.existsSync(path.join(dir, 'folder.mjs'))) return dir;
  }
  throw new Error('lucide-react не найден: pnpm install в дереве или укажи путь');
}

/** node-дерево Lucide → строка SVG-элементов. React-ключ (`key`) не нужен. */
function serialize(nodes) {
  return nodes
    .map(([tag, attrs]) => {
      const clean = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}="${String(v)}"`)
        .join(' ');
      return `<${tag} ${clean}/>`;
    })
    .join('');
}

async function loadLucideIcons() {
  const dir = findLucideDir();
  const bodies = {};
  // Часть имён — алиасы (`export { default } from './building-complex.mjs'`),
  // у них нет своего __iconData: идём по реэкспорту до реального модуля.
  const iconDataOf = async (file, depth = 0) => {
    if (depth > 4) throw new Error(`цепочка алиасов: ${file}`);
    const full = path.join(dir, `${file}.mjs`);
    const mod = await import(pathToFileURL(full).href);
    if (mod.__iconData) return mod.__iconData;
    const src = fs.readFileSync(full, 'utf8');
    const alias = src.match(/export \{ default \} from '\.\/(.+)\.mjs'/);
    if (!alias) throw new Error(`нет __iconData: ${file}`);
    return iconDataOf(alias[1], depth + 1);
  };
  for (const [key, [, file]] of Object.entries(LUCIDE)) {
    bodies[key] = serialize((await iconDataOf(file)).node);
  }
  return bodies;
}

function buildTile({ seed }) {
  const rng = mulberry32(seed);
  const wrap = (v) => ((v % TILE) + TILE) % TILE;

  // Словарь имён: акцентные темы Nodus весомее (вес 2), остальные — 1.
  const pond = [];
  for (const n of [...Object.keys(LUCIDE), ...Object.keys(CUSTOM)]) {
    const weight = ACCENT.has(n) ? 2 : 1;
    for (let k = 0; k < weight; k += 1) pond.push(n);
  }
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  shuffle(pond);

  // --- 1. Blue-noise: точки расходятся с учётом радиусов (лого крупнее),
  // поэтому между иконками ВСЕГДА остаётся зазор и нет пустых карманов. ---
  const LOGO_HALF = 34;
  const NORMAL_HALF = 27;
  const LOGO_COUNT = 7;
  const NORMAL_COUNT = 300;
  const nodes = [];
  for (let i = 0; i < LOGO_COUNT; i += 1) {
    nodes.push({ x: rng() * TILE, y: rng() * TILE, r: LOGO_HALF, logo: true });
  }
  for (let i = 0; i < NORMAL_COUNT; i += 1) {
    nodes.push({ x: rng() * TILE, y: rng() * TILE, r: NORMAL_HALF, logo: false });
  }
  const RELAX_CELL = 80;
  const relaxNear = (x, y) => {
    const cx = Math.floor(x / RELAX_CELL);
    const cy = Math.floor(y / RELAX_CELL);
    const out = [];
    const n = Math.ceil(TILE / RELAX_CELL);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const k = `${((cx + dx) % n + n) % n}:${((cy + dy) % n + n) % n}`;
        const list = grid.get(k);
        if (list) out.push(...list);
      }
    }
    return out;
  };
  let grid = new Map();
  for (let iter = 0; iter < 160; iter += 1) {
    grid = new Map();
    for (const node of nodes) {
      const k = `${Math.floor(node.x / RELAX_CELL)}:${Math.floor(node.y / RELAX_CELL)}`;
      const list = grid.get(k);
      if (list) list.push(node);
      else grid.set(k, [node]);
    }
    const disp = nodes.map(() => ({ x: 0, y: 0 }));
    for (const node of nodes) {
      for (const other of relaxNear(node.x, node.y)) {
        if (other === node) continue;
        let dx = other.x - node.x;
        let dy = other.y - node.y;
        if (dx > TILE / 2) dx -= TILE;
        if (dx < -TILE / 2) dx += TILE;
        if (dy > TILE / 2) dy -= TILE;
        if (dy < -TILE / 2) dy += TILE;
        const d = Math.hypot(dx, dy);
        // Желаемый зазор 5 px между крупными/лого, 4 — между обычными.
        const desired = node.r + other.r + (node.logo || other.logo ? 8 : 6);
        if (d < desired && d > 0.01) {
          const push = (desired - d) * 0.5;
          disp[nodes.indexOf(node)].x -= (dx / d) * push;
          disp[nodes.indexOf(node)].y -= (dy / d) * push;
        }
      }
    }
    for (let i = 0; i < nodes.length; i += 1) {
      nodes[i].x = wrap(nodes[i].x + disp[i].x * 0.55);
      nodes[i].y = wrap(nodes[i].y + disp[i].y * 0.55);
    }
  }

  // --- 2. Размер иконки выводится из свободного места: половина = минимум
  // (расстояние до соседа − его половина − зазор), поэтому вплотную без
  // наложений и без пустот. 4 прохода сходятся, т.к. половины ограничены 34. ---
  const halves = nodes.map((n) => (n.logo ? LOGO_HALF : NORMAL_HALF));
  const distanceTo = (a, b) => {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (dx > TILE / 2) dx -= TILE;
    if (dx < -TILE / 2) dx += TILE;
    if (dy > TILE / 2) dy -= TILE;
    if (dy < -TILE / 2) dy += TILE;
    return Math.hypot(dx, dy);
  };
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i].logo) continue;
      let h = 26;
      for (let j = 0; j < nodes.length; j += 1) {
        if (i === j) continue;
        const room = distanceTo(nodes[i], nodes[j]) - halves[j] - 3.5;
        if (room < h) h = room;
      }
      halves[i] = Math.max(14, Math.min(34, h));
    }
  }

  // --- 3. Имена: без повторов вблизи (владелец: «по 5–10 одинаковых рядом»). ---
  const items = [];
  const SAME_ICON_RADIUS = 110;
  const sameIconNear = (x, y, name) => {
    for (const it of items) {
      if (it.name !== name) continue;
      if (distanceTo({ x, y }, it) < SAME_ICON_RADIUS) return true;
    }
    return false;
  };
  let deck = [];
  let di = 0;
  const nextName = () => {
    if (di >= deck.length) {
      deck = shuffle([...pond]);
      di = 0;
    }
    const name = deck[di];
    di += 1;
    return name;
  };

  const order = shuffle(nodes.map((_, i) => i));
  for (const idx of order) {
    const node = nodes[idx];
    const half = halves[idx];
    // Логотип — крупнее и без поворота, остальные — в пределах свободного места.
    const scale = +(half / 15.1).toFixed(2);
    let name = node.logo ? 'nodus' : nextName();
    if (!node.logo) {
      for (let pick = 0; pick < 8 && sameIconNear(node.x, node.y, name); pick += 1) {
        name = nextName();
      }
    }
    const item = {
      x: +node.x.toFixed(1),
      y: +node.y.toFixed(1),
      scale,
      name,
      rot: node.logo ? 0 : Math.round(rng() * 36 - 18),
      half,
    };
    items.push(item);
  }

  // --- 4. Самопроверка раскладки: минимум наложений и максимум пустоты. ---
  let minGap = Infinity;
  let maxHole = 0;
  for (let i = 0; i < items.length; i += 1) {
    let nearest = Infinity;
    for (let j = 0; j < items.length; j += 1) {
      if (i === j) continue;
      const d = distanceTo(items[i], items[j]) - items[i].half - items[j].half;
      if (d < nearest) nearest = d;
      if (d < minGap) minGap = d;
    }
    if (nearest > maxHole) maxHole = nearest;
  }
  console.log(
    `  раскладка: ${items.length} значков, минимальный зазор ${minGap.toFixed(1)} px, ` +
      `максимальная пустота ${maxHole.toFixed(1)} px`,
  );

  return { items };
}

async function main() {
  const lucideBodies = await loadLucideIcons();
  const bodies = { ...lucideBodies, ...CUSTOM, nodus: NODUS_LOGO };
  const themes = [
    {
      file: 'chat-wallpaper-light.svg',
      ink: '#16233a',
      opacity: 0.08,
      title: 'светлая тема: графит 8%',
    },
    {
      file: 'chat-wallpaper-dark.svg',
      ink: '#e8e8e6',
      opacity: 0.06,
      title: 'тёмная тема: светлый граф 6%',
    },
  ];

  for (const theme of themes) {
    const { items } = buildTile({ seed: SEED });
    // Заливки (#000 в точках логотипа/пузырьке уровня) красим в цвет темы:
    // чёрные точки на почти чёрном фоне исчезали — владелец видел «обрезку».
    const themeBodies = Object.fromEntries(
      Object.entries(bodies).map(([key, body]) => [key, body.replaceAll('#000', theme.ink)]),
    );
    const defs = Object.entries(themeBodies)
      .map(([key, body]) => `<g id="ic-${key}"${key === 'nodus' ? ' transform="scale(1.2)"' : ''}>${body}</g>`)
      .join('\n    ');
    // Бесшовность: иконка, пересекающая край плитки, повторяется на
    // противоположной стороне (иначе на стыке видна вертикальная пустая полоса,
    // ровно в центре широкого экрана — замечание владельца 13.11). Логотипы
    // стоят вдали от края и не дублируются.
    const uses = [];
    for (const i of items) {
      const copies = [[0, 0]];
      // Дублируются ВСЕ иконки, включая логотип: иначе логотип, попавший
      // на край плитки, обрезался (замечание владельца).
      if (i.x < i.half) copies.push([TILE, 0]);
      if (i.x > TILE - i.half) copies.push([-TILE, 0]);
      if (i.y < i.half) copies.push([0, TILE]);
      if (i.y > TILE - i.half) copies.push([0, -TILE]);
      if (i.x < i.half && i.y < i.half) copies.push([TILE, TILE]);
      if (i.x < i.half && i.y > TILE - i.half) copies.push([TILE, -TILE]);
      if (i.x > TILE - i.half && i.y < i.half) copies.push([-TILE, TILE]);
      if (i.x > TILE - i.half && i.y > TILE - i.half) copies.push([-TILE, -TILE]);
      for (const [ox, oy] of copies) {
        // Lucide-иконки нарисованы в боксе 0…24: чтобы ЦЕНТР иконки попал в
        // точку раскладки, сдвигаем на −12 до поворота. Знак Nodus нарисован
        // вокруг нуля и центрируется сам (раньше все Lucide-иконки съезжали
        // на пол-ячейки — отсюда дыры у логотипов и наложения).
        const shift = i.name === 'nodus' ? 0 : -12;
        uses.push(
          `<use href="#ic-${i.name}" transform="translate(${+(i.x + ox).toFixed(1)} ${+(i.y + oy).toFixed(1)}) rotate(${i.rot}) scale(${i.scale}) translate(${shift} ${shift})"/>`,
        );
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}" fill="none" opacity="${theme.opacity}">
  <!-- Фоновая плитка зоны чата Nodus (#849), ${theme.title}.
       Иконки: Lucide 1.66 (ISC, https://lucide.dev) + Tabler Icons (crane, MIT)
       + собственные (экскаватор, конвейер, труба, жилет, уровень) + знак Nodus.
       Плотная хаотичная россыпь без сетки, случайный угол, зазоры 0,5–2,5 px,
       без наложений; бесшовная — всё, что пересекает край, повторено напротив.
       Сгенерировано gen-wallpaper.cjs; не править руками. -->
  <g stroke="${theme.ink}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">
  <defs>
    ${defs}
  </defs>
    ${uses.join('\n    ')}
  </g>
</svg>
`;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, theme.file);
    fs.writeFileSync(out, svg);
    console.log(
      `${theme.file}: ${items.length} значков (${uses.length} use), ${(svg.length / 1024).toFixed(0)} КБ`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
