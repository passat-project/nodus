#!/usr/bin/env node
// Выкатка и откат прода из готовых образов (#565, ADR-0036). Единственный
// вход на прод этого хоста: на сервере ничего не собирается, «что сейчас на
// проде» определяется версией в D:\NodusProd\.env, а не каталогом, из которого
// случайно запустили compose (так 02.11 умерла раздача десктопа, #560).
//
//   node scripts/prod-deploy.mjs --version 0.5.0 [--prod-dir D:/NodusProd] [--dry-run]
//   node scripts/prod-deploy.mjs --current          # поднять текущую версию после перезагрузки
//
// Шаги: проверить .env → достать kit версии из тега (рабочее дерево не трогаем)
// → записать NODUS_VERSION → config → pull → up -d → дождаться healthy → смок
// → строка в deployments.log. Провал печатает команду отката, но сам не
// откатывает: решение за оператором.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildComposeArgs,
  isAbsoluteHostPath,
  parseEnv,
  replaceEnvValue,
} from './lib/prod-deploy.mjs';
import {
  digests,
  imageLabel,
  repoDigests,
  resolveTagCommit,
  sanitizeEnv,
  waitHealthy,
} from './lib/prod-deploy-io.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const SEMVER = /^\d+\.\d+\.\d+$/;
const SERVICES = [
  { container: 'nodus_web', image: 'web' },
  { container: 'nodus_api', image: 'api' },
  { container: 'nodus_gateway', image: 'gateway' },
];
const HEALTH_TIMEOUT_MS = 180_000;

try {
  deploy(args);
} catch (error) {
  console.error(`prod-deploy: ${error.message}`);
  process.exitCode = 1;
}

function deploy({ version, current, prodDir, repo, dryRun, smokeBase }) {
  const prod = resolve(String(prodDir ?? 'D:/NodusProd'));
  const repoDir = resolve(String(repo ?? repoRoot));
  const envPath = join(prod, '.env');
  if (!existsSync(envPath)) fail(`нет ${envPath} — прод-каталог не подготовлен`);

  const envText = readFileSync(envPath, 'utf8');
  const env = parseEnv(envText);
  if (!isAbsoluteHostPath(env.NODUS_DESKTOP_DIR)) {
    fail(
      `в ${envPath} NODUS_DESKTOP_DIR «${env.NODUS_DESKTOP_DIR ?? ''}» не абсолютный: относительный путь резолвится от каталога compose-проекта и молча ломает раздачу оболочки (#560)`,
    );
  }
  const profiles = String(env.COMPOSE_PROFILES ?? '')
    .split(',')
    .map((profile) => profile.trim())
    .filter(Boolean);
  if (profiles.length === 0) {
    fail(
      `в ${envPath} не задан COMPOSE_PROFILES (например office,tunnel) — профили прода задаются явно`,
    );
  }

  const target = current === true ? env.NODUS_VERSION : String(version ?? '');
  if (!SEMVER.test(target)) {
    fail(`версия «${target}» не в форме X.Y.Z (для перезапуска текущей — --current)`);
  }
  const tag = `v${target}`;
  const previous = current === true ? target : (env.NODUS_VERSION ?? '');
  const registry = String(env.NODUS_REGISTRY || 'ghcr.io/passat-project').replace(/\/+$/, '');

  const { kitDir, commit, smokePath } = ensureKit({
    repoDir,
    prod,
    tag,
    offline: current === true,
  });
  const composeArgs = buildComposeArgs({ prodDir: prod, kitDir, profiles });
  // Окружение оператора не протекает в compose: shell-env приоритетнее
  // --env-file, и экспортированный NODUS_VERSION/NODUS_REGISTRY/COMPOSE_PROFILES
  // молча увёл бы на прод не ту версию или чужой registry (security-review #565).
  const compose = (rest, extraEnv = {}) =>
    execFileSync('docker', ['compose', ...composeArgs, ...rest], {
      stdio: 'inherit',
      cwd: prod,
      env: { ...sanitizeEnv(), NODUS_VERSION: target, ...extraEnv },
    });

  if (dryRun) {
    console.log(`prod-deploy: dry-run версии ${target}`);
    console.log(`  kit: ${kitDir}`);
    console.log(`  профили: ${profiles.join(', ')}`);
    compose(['config', '--quiet']);
    console.log('  config --quiet: ок');
    return;
  }

  if (current !== true) writeVersion(envPath, envText, target);

  try {
    compose(['config', '--quiet']);
    if (current === true) {
      // После перезагрузки хоста сети может не быть: локальные образы уже
      // есть, pull_policy: missing поднимет их без registry.
      try {
        compose(['pull', 'web', 'api', 'gateway']);
      } catch {
        console.warn('prod-deploy: pull недоступен — поднимаю локальные образы (--current)');
      }
    } else {
      compose(['pull', 'web', 'api', 'gateway']);
    }
    verifyImages({ registry, target, tag, commit });
    verifyPinnedDigests({ kitDir, registry, target });
    compose(['up', '-d']);
  } catch (error) {
    if (current !== true && previous) restoreVersion(envPath, previous);
    logDeploy(prod, { version: target, previous, status: 'fail', note: 'config/pull/up' });
    fail(
      `выкатка ${target} не удалась: ${error.message}. Откат: --version ${previous || '<прежняя>'}`,
    );
  }

  const unhealthy = waitHealthy(
    SERVICES.map((service) => service.container),
    HEALTH_TIMEOUT_MS,
  );
  if (unhealthy.length > 0) {
    logDeploy(prod, {
      version: target,
      previous,
      status: 'fail',
      note: `не healthy: ${unhealthy.join(', ')}`,
    });
    fail(
      `сервисы не стали healthy: ${unhealthy.join(', ')}. Откат: node scripts/prod-deploy.mjs --version ${previous || '<прежняя>'}`,
    );
  }

  const smokeArgs = [smokePath ?? join(repoDir, 'scripts/prod-smoke.mjs')];
  if (smokeBase) smokeArgs.push('--base', String(smokeBase));
  try {
    execFileSync('node', smokeArgs, { stdio: 'inherit', cwd: repoDir });
  } catch {
    logDeploy(prod, { version: target, previous, status: 'fail', note: 'смок' });
    fail(
      `смок красный — выкатка ${target} не принята. Откат: node scripts/prod-deploy.mjs --version ${previous || '<прежняя>'}`,
    );
  }

  pinDigests(kitDir, registry, target);
  logDeploy(prod, {
    version: target,
    previous,
    status: 'ok',
    note: digests(registry, target, SERVICES),
  });
  console.log(`prod-deploy: версия ${target} на проде`);
}

// Kit — единственная часть поставки без своего хеша: перемещённый тег увёз бы
// на прод чужой compose с боевыми секретами. Поэтому сверяем тег на origin
// (resolveTagCommit) и привязываем образы к тому же коммиту (verifyImages).
// Смок материализуется из тега рядом с compose: проверять поставку скриптом
// из рабочего дерева — значит доверять дереву больше, чем тегу.
function ensureKit({ repoDir, prod, tag, offline }) {
  const kitDir = join(prod, 'kit', tag);
  const files = ['docker-compose.yml', 'compose.prod.yaml'];
  const commit = resolveTagCommit(repoDir, tag, { offline });
  const sources = new Map();
  for (const file of files) {
    try {
      sources.set(
        file,
        execFileSync('git', ['-C', repoDir, 'show', `${tag}:${file}`], {
          encoding: 'buffer',
          maxBuffer: 16 * 1024 * 1024,
        }),
      );
    } catch {
      fail(
        `в теге ${tag} нет ${file} — версия выпущена до перехода на готовые образы, выкатывайте по старому runbook`,
      );
    }
  }
  const smoke = showOptional(repoDir, tag, 'scripts/prod-smoke.mjs');
  if (existsSync(kitDir)) {
    for (const file of files) {
      if (!readFileSync(join(kitDir, file)).equals(sources.get(file))) {
        fail(
          `kit ${kitDir} расходится с тегом ${tag} (${file}) — каталог kit не редактируется вручную`,
        );
      }
    }
    return { kitDir, commit, smokePath: materializeSmoke(kitDir, smoke) };
  }
  mkdirSync(kitDir, { recursive: true });
  for (const file of files) writeFileSync(join(kitDir, file), sources.get(file));
  return { kitDir, commit, smokePath: materializeSmoke(kitDir, smoke) };
}

function showOptional(repoDir, tag, file) {
  try {
    return execFileSync('git', ['-C', repoDir, 'show', `${tag}:${file}`], {
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function materializeSmoke(kitDir, smoke) {
  if (!smoke) return null;
  const path = join(kitDir, 'prod-smoke.mjs');
  if (!existsSync(path) || !readFileSync(path).equals(smoke)) writeFileSync(path, smoke);
  return path;
}

// Digest-якорь на повторные выкатки: registry-теги мутабельны, поэтому первая
// успешная выкатка версии запоминает RepoDigest, а повторная (откат) обязана
// увидеть те же байты. Подмену registry на первой выкатке это не ловит —
// граница доверия остаётся `.env` + origin (см. ADR-0036).
function verifyPinnedDigests({ kitDir, registry, target }) {
  const pinned = readPinnedDigests(kitDir);
  if (!pinned) return;
  const actual = repoDigests(registry, target, SERVICES);
  for (const { image } of SERVICES) {
    if (pinned[image] && actual[image] && pinned[image] !== actual[image]) {
      fail(
        `образ ${image}:${target} подменён в registry (${actual[image]} вместо ${pinned[image]}) — выкатка остановлена`,
      );
    }
  }
}

function pinDigests(kitDir, registry, target) {
  if (readPinnedDigests(kitDir)) return;
  writeFileSync(
    join(kitDir, 'digests.json'),
    `${JSON.stringify(repoDigests(registry, target, SERVICES), null, 2)}\n`,
  );
}

function readPinnedDigests(kitDir) {
  const path = join(kitDir, 'digests.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`файл ${path} не разбирается — удалите его и выкатите версию заново`);
  }
}

function verifyImages({ registry, target, tag, commit }) {
  for (const { image } of SERVICES) {
    const ref = `${registry}/nodus-${image}:${target}`;
    let revision;
    try {
      revision = imageLabel(ref, 'org.opencontainers.image.revision');
    } catch (error) {
      fail(`не удалось прочитать образ ${ref}: ${error.message}`);
    }
    if (revision !== commit) {
      fail(
        `образ ${ref} собран из «${revision || '—'}», а тег ${tag} указывает на ${commit}: образы и kit разошлись, выкатка остановлена`,
      );
    }
  }
}

function writeVersion(envPath, envText, version) {
  const next = replaceEnvValue(envText, 'NODUS_VERSION', version);
  const tmp = `${envPath}.tmp`;
  // mode при создании: на Linux tmp не должен быть доступен шире владельца.
  // Windows ACL наследуется от каталога прод-данных — D:\NodusProd держим
  // доступным только администратору (runbook prod-update.md).
  writeFileSync(tmp, next, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows: chmod не задаёт ACL.
  }
  renameSync(tmp, envPath);
}

function restoreVersion(envPath, previous) {
  writeVersion(envPath, readFileSync(envPath, 'utf8'), previous);
  console.warn(`prod-deploy: .env возвращён на ${previous} (выкатка не дошла до up)`);
}

function logDeploy(prod, { version, previous, status, note }) {
  const line = [new Date().toISOString(), version, previous || '-', status, note].join('\t');
  try {
    mkdirSync(prod, { recursive: true });
    writeFileSync(join(prod, 'deployments.log'), `${line}\n`, { flag: 'a' });
  } catch (error) {
    console.warn(`prod-deploy: не удалось записать deployments.log: ${error.message}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]?.replace(/^--/, '')?.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!key) continue;
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function fail(message) {
  throw new Error(message);
}
