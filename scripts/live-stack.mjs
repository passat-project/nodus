#!/usr/bin/env node
/**
 * Песочница агента — контур разработки ветки (ADR-0002, карта портов в
 * AGENTS.md): api :3011 + gateway :3012 + web :4173 (non-mock). Режимы web
 * (#247): `up --dev` — vite dev-сервер (правки фронта видны за секунды, цикл
 * приёмки и правок), `up` / `up --preview` — собранная копия (финальная
 * проверка перед вердиктом владельцу). Исключение «песочница non-mock» —
 * `up --dev --mock <домены|all>` (#431, ADR-0001): UI-чекпоинт ДО бэкенда —
 * MSW в vite dev, вход любыми данными; пробы поведения и e2e — без моков.
 * Живой стек для приёмки владельцем и локальных e2e; прод-контейнеры docker
 * НЕ трогает. PID-файл .live-stack/pids.json убивает «сирот» прошлых сессий:
 * перед up порты проверяются, чужой процесс на порту = громкая ошибка, а не
 * молчаливый EADDRINUSE свежеподнятого.
 *
 * Команды: up [--dev] [--mock <домены|all>] | up [--preview] | down | status |
 * bootstrap (pnpm live-stack <команда>).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dbName, loadDotEnv, sandboxMailEnv, sandboxSecrets } from './live-stack-env.mjs';
import { mockEnvOf } from './live-stack-mock.mjs';
import { printStatus } from './live-stack-status.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, '.live-stack');
const PID_FILE = path.join(STATE_DIR, 'pids.json');
const MODE_FILE = path.join(STATE_DIR, 'mode');
/** Единый источник тестовых пользователей сред (#247): CI, песочница, e2e. */
const E2E_USERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/e2e/e2e-users.json'), 'utf8'));

const PORTS = { api: 3011, gateway: 3012, web: 4173 };
const HEALTH = {
  api: 'http://127.0.0.1:3011/api/v1/health/ready',
  gateway: 'http://127.0.0.1:3012/health',
  web: 'http://127.0.0.1:4173/',
};

/** Прослушивает ли кто-то порт (connect-проба; ошибка соединения = свободен). */
function portBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPids() {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

async function waitHealthy(name, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      /* ещё поднимается */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `${name} did not become healthy in ${Math.round(timeoutMs / 1000)}s (${url}) - see .live-stack/${name}.log`,
  );
}

/** Запуск: прямой node-процесс без shell-цепочек (PID = сам сервис). */
function startService(name, args, env, cwd = ROOT) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const log = fs.openSync(path.join(STATE_DIR, `${name}.log`), 'w');
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  return child.pid;
}

function viteBin() {
  // Резолв из пакета web (pnpm-симлинки) — без pnpm/cmd-цепочек в процессах.
  const require = createRequire(path.join(ROOT, 'apps/web/package.json'));
  return path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
}

function run(command, args = [], env = process.env) {
  const r = spawnSync(command, args, { cwd: ROOT, shell: true, stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Идемпотентный бутстрап изолированной БД песочницы (#178): создать
 *  nodus_night, если нет -> применить миграции -> сид (роли, флаги, CI-
 *  пользователи e2e с паролями из tests/e2e/e2e-users.json, #247) ->
 *  night-пользователи для проб (scripts/night-users.mjs). Работает и как
 *  авто-шаг `up`, и как отдельная команда `pnpm live-stack bootstrap`. */
function bootstrapNight(env) {
  const user = env.POSTGRES_USER ?? 'nodus';
  const probe = spawnSync(
    `docker exec nodus_postgres psql -U ${user} -tAc "SELECT 1 FROM pg_database WHERE datname='nodus_night'"`,
    { shell: true, encoding: 'utf8' },
  );
  if (probe.status !== 0) {
    console.warn(
      'sandbox: не удалось проверить nodus_night через docker (docker не запущен?).\n' +
        'Продолжаю — если api не станет healthy, см. навык nodus-dev-testing (bootstrap).',
    );
    return;
  }
  if (probe.stdout.trim() !== '1') {
    console.log('sandbox: создаю изолированную БД nodus_night (однократно)...');
    const created = spawnSync(
      `docker exec nodus_postgres psql -U ${user} -c "CREATE DATABASE nodus_night"`,
      {
        shell: true,
        stdio: 'inherit',
      },
    );
    if (created.status !== 0) process.exit(created.status ?? 1);
  }
  console.log('sandbox: миграции nodus_night (idempotent)...');
  run('pnpm --filter @nodus/api exec prisma migrate deploy', [], {
    ...process.env,
    DATABASE_URL: env.DATABASE_URL,
  });
  // Пользователи с ПУБЛИЧНЫМИ паролями (сид, night-a/b) — ТОЛЬКО в
  // nodus_night: на любой другой БД (SANDBOX_ON_PROD, явный DATABASE_URL у
  // bootstrap) они перезаписали бы пароль боевого admin@nodus.by и завели бы
  // известные учётки в проде.
  if (dbName(env.DATABASE_URL ?? '') !== 'nodus_night') {
    console.warn('sandbox: БД не nodus_night — сид и night-пользователи пропущены.');
    return;
  }
  // Клиент Prisma (gitignored) — до сида: свежий клон/worktree или смена
  // схемы на ветке, а `build` (generate) идёт позже бутстрапа.
  run('pnpm --filter @nodus/api db:generate');
  console.log('sandbox: сид nodus_night — роли, флаги, пользователи e2e (idempotent)...');
  run('pnpm --filter @nodus/api db:seed', [], {
    ...process.env,
    DATABASE_URL: env.DATABASE_URL,
    SEED_ADMIN_PASSWORD: E2E_USERS.admin.password,
    SEED_DEMO_PASSWORD: E2E_USERS.second.password,
  });
  console.log('sandbox: night-пользователи для проб (idempotent)...');
  run('node scripts/night-users.mjs', [], { ...process.env, DATABASE_URL: env.DATABASE_URL });
}

async function up(mode, mock) {
  const existing = Object.entries(readPids()).filter(([, pid]) => pidAlive(pid));
  if (existing.length > 0) {
    console.error(
      `live-stack already running (${existing.map(([n, p]) => `${n}=${p}`).join(', ')}). Run first: pnpm live-stack down`,
    );
    process.exit(1);
  }
  for (const [name, port] of Object.entries(PORTS)) {
    if (await portBusy(port)) {
      console.error(
        `Port :${port} (${name}) is taken by a FOREIGN process (likely an orphan of a past session).\n` +
          `Find and kill it: netstat -ano | findstr :${port}  ->  taskkill /PID <pid> /F`,
      );
      process.exit(1);
    }
  }

  // Эфемерный конвертер песочницы (план-Б #56, Р10): прод-gotenberg теперь
  // только во internal-сети без портов — api песочницы (хост) ходит в свой
  // экземпляр профиля sandbox на loopback-порту. Живёт, пока песочница:
  // down() его останавливает.
  run('docker compose --profile sandbox up -d gotenberg-sandbox', [], { ...process.env });

  // Изоляция песочницы (#178, урок-инцидент #175): без явного env процесса
  // песочница САМА уходит на изолированные nodus_night + Redis db1 — из .env
  // (там прод-значения) конструируем песочные. Явный env процесса главнее;
  // осознанный прогон против прода — SANDBOX_ON_PROD=1 (не рекомендуется:
  // два outbox-диспетчера на одной БД воруют события, пробные данные — в прод).
  const dotenv = loadDotEnv(ROOT);
  const base = { ...dotenv, ...process.env };
  const nightUrl = (url) => url.replace(/\/nodus(\?|$)/, '/nodus_night$1');
  if (!process.env.DATABASE_URL && base.DATABASE_URL) {
    const rewritten = nightUrl(base.DATABASE_URL);
    if (rewritten !== base.DATABASE_URL) {
      base.DATABASE_URL = rewritten;
      console.log(
        'sandbox: DATABASE_URL -> nodus_night (авто-изоляция; прод — только SANDBOX_ON_PROD=1)',
      );
    }
  }
  if (!process.env.REDIS_URL && base.REDIS_URL) {
    // Суффикс БД обязателен: без него redis-клиент сидит в db0 = ПРОД-редис —
    // два издателя одного стрима событий крадут fanout друг у друга.
    const rewritten = base.REDIS_URL.replace(/^(rediss?:\/\/[^/?#]*)(\/\d+)?([?#].*)?$/, '$1/1$3');
    if (rewritten !== base.REDIS_URL) {
      base.REDIS_URL = rewritten;
      console.log('sandbox: REDIS_URL -> db1 (авто-изоляция стрима/очередей от прода)');
    }
  }
  if (dbName(base.DATABASE_URL ?? '') === 'nodus' && !process.env.SANDBOX_ON_PROD) {
    console.error(
      `DATABASE_URL указывает на прод-базу 'nodus' (${base.DATABASE_URL.replace(/\/\/[^@]*@/, '//***@')}).\n` +
        `Песочница live-stack работает на изолированной БД nodus_night (авто при запуске без env).\n` +
        `Осознанный запуск против прода (не рекомендуется): SANDBOX_ON_PROD=1.`,
    );
    process.exit(1);
  }
  bootstrapNight(base);
  // Свои секреты подписи (#247): явный env процесса главнее (осознанный запуск).
  const secrets = sandboxSecrets(dotenv, STATE_DIR);
  if (!process.env.JWT_SECRET) base.JWT_SECRET = secrets.JWT_SECRET;
  if (!process.env.STORAGE_URL_SECRET) base.STORAGE_URL_SECRET = secrets.STORAGE_URL_SECRET;
  // Итоговое значение, а не только сгенерированное: прод-секрет мог прийти
  // и из env процесса (`set -a; . .env`).
  for (const key of ['JWT_SECRET', 'STORAGE_URL_SECRET']) {
    if (base[key] && base[key] === dotenv[key] && !process.env.SANDBOX_ON_PROD) {
      console.error(`${key} песочницы совпадает с .env (прод) — уберите его из env процесса.`);
      process.exit(1);
    }
  }

  console.log(`Building api + gateway${mode === 'preview' ? ' + web (non-mock)' : ''}...`);
  run('pnpm --filter @nodus/api build');
  run('pnpm --filter @nodus/gateway build');
  if (mode === 'preview') {
    // Прямой vite build: non-mock явно (turbo-кэш тоже видит env — turbo.json —
    // но здесь не хотим пересобирать остальной граф).
    // VITE_SANDBOX_DEV_UI (#257): страница дизайн-системы `/dev/ui` нужна
    // владельцу на песочнице (preview `:4173`) — в прод-сборку она не попадает:
    // флаг выставляется только здесь, прод-CI/docker его не получает.
    run('pnpm --filter @nodus/web exec vite build', [], {
      ...process.env,
      VITE_API_MOCK: 'false',
      VITE_SANDBOX_DEV_UI: '1',
    });
  }

  const pids = {
    api: startService('api', ['apps/api/dist/main.js'], {
      ...base,
      API_PORT: String(PORTS.api),
      NODE_ENV: 'development',
      COOKIE_SECURE: 'false',
      // e2e-прогоны подряд с двух браузеров выбивают дефолт 3000/мин с NAT-IP.
      RATE_LIMIT_MAX: '30000',
      // Почтовый контур песочницы — только тестовый ящик (MAIL_TEST_*),
      // изоляция и анти-брутфорс Kerio: live-stack-env.sandboxMailEnv.
      ...sandboxMailEnv(base),
      // ONLYOFFICE (#138): documentserver-контейнер (compose profile office)
      // ходит за файлами/колбэками на ЭТОТ api — адрес хоста из контейнера.
      OFFICE_API_INTERNAL_URL: `http://host.docker.internal:${PORTS.api}`,
      // Gotenberg (#139, производные): api на хосте — loopback-порт compose.
      GOTENBERG_URL: 'http://127.0.0.1:3100',
    }),
    gateway: startService('gateway', ['apps/gateway/dist/main.js'], {
      ...base,
      GATEWAY_PORT: String(PORTS.gateway),
    }),
    web: startService(
      'web',
      [
        viteBin(),
        // dev: vite dev-сервер (HMR, dist не пишет — инцидент «мок-сборка
        // перетирала dist» не рецидивирует); preview: собранная копия.
        ...(mode === 'dev' ? [] : ['preview']),
        '--host',
        '127.0.0.1',
        '--port',
        String(PORTS.web),
        '--strictPort',
      ],
      {
        ...base,
        // Песочница всегда живая: в dev-режиме VITE_API_MOCK из .env (моки
        // dev-сервера владельца) перекрывается env процесса (приоритет vite).
        // Моки — только явный `--dev --mock` (#431); иначе песочница живая.
        // `all` — это `true` (контракт разбора VITE_API_MOCK), не имя домена.
        VITE_API_MOCK: mock === 'all' ? 'true' : (mock ?? 'false'),
        NODUS_API_DEV_TARGET: `http://127.0.0.1:${PORTS.api}`,
        NODUS_GATEWAY_DEV_TARGET: `http://127.0.0.1:${PORTS.gateway}`,
      },
      path.join(ROOT, 'apps/web'),
    ),
  };
  fs.writeFileSync(PID_FILE, JSON.stringify(pids, null, 2));
  fs.writeFileSync(MODE_FILE, mock ? `${mode}+mock:${mock}` : mode);

  console.log('Waiting for stack health...');
  await waitHealthy('api', HEALTH.api, 60_000);
  await waitHealthy('gateway', HEALTH.gateway, 30_000);
  await waitHealthy('web', HEALTH.web, 30_000);
  console.log(
    `Ready (${mode}${mock ? `, моки: ${mock}` : ''}): web http://127.0.0.1:${PORTS.web} ` +
      `(api :${PORTS.api}, gateway :${PORTS.gateway}); logs in .live-stack/`,
  );
}

function killTree(pid) {
  if (process.platform === 'win32') {
    // Одной строкой: shell=true + массив аргументов = DeprecationWarning.
    spawnSync(`taskkill /PID ${pid} /T /F`, { shell: true });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* уже ушёл */
    }
  }
}

function down() {
  let stopped = 0;
  for (const [name, pid] of Object.entries(readPids())) {
    if (pidAlive(pid)) {
      killTree(pid);
      console.log(`stopped ${name} (pid ${pid})`);
      stopped += 1;
    }
  }
  fs.rmSync(PID_FILE, { force: true });
  fs.rmSync(MODE_FILE, { force: true });
  // Эфемерный конвертер песочницы (план-Б #56, Р10) — гасим вместе со стеком.
  run('docker compose --profile sandbox stop gotenberg-sandbox', [], { ...process.env });
  console.log(
    stopped === 0 ? 'Stack was not running (no/empty PID file).' : `Stopped processes: ${stopped}`,
  );
}

async function status() {
  const pids = readPids();
  const alive = Object.values(pids).some(pidAlive);
  const mode = fs.existsSync(MODE_FILE) && alive ? fs.readFileSync(MODE_FILE, 'utf8') : null;
  await printStatus({ pids, pidAlive, portBusy, ports: PORTS, mode });
}

const command = process.argv[2];
try {
  if (command === 'up') {
    const mock = mockEnvOf(process.argv);
    const dev = process.argv.includes('--dev');
    if (mock && !dev) {
      console.error('моки работают только в vite dev (#171): используйте `up --dev --mock …`');
      process.exit(1);
    }
    await up(dev ? 'dev' : 'preview', mock);
  } else if (command === 'down') down();
  else if (command === 'status') await status();
  else if (command === 'bootstrap') {
    // Ручной бутстрап изоляции (up делает это сам): env — как у up.
    const dotenv = loadDotEnv(ROOT);
    const env = { ...dotenv, ...process.env };
    if (!process.env.DATABASE_URL && env.DATABASE_URL) {
      env.DATABASE_URL = env.DATABASE_URL.replace(/\/nodus(\?|$)/, '/nodus_night$1');
    }
    bootstrapNight(env);
  } else {
    console.error(
      'Usage: pnpm live-stack <up [--dev] [--mock <домены|all>] | up [--preview] | down | status | bootstrap>',
    );
    process.exit(1);
  }
} catch (error) {
  console.error(`live-stack: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
