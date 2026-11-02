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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const SEMVER = /^\d+\.\d+\.\d+$/;
const SERVICES = ['nodus_web', 'nodus_api', 'nodus_gateway'];
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

  const kitDir = ensureKit({ repoDir, prod, tag });
  const composeArgs = buildComposeArgs({ prodDir: prod, kitDir, profiles });
  const compose = (rest, extraEnv = {}) =>
    execFileSync('docker', ['compose', ...composeArgs, ...rest], {
      stdio: 'inherit',
      cwd: prod,
      env: { ...process.env, ...extraEnv },
    });

  if (dryRun) {
    console.log(`prod-deploy: dry-run версии ${target}`);
    console.log(`  kit: ${kitDir}`);
    console.log(`  профили: ${profiles.join(', ')}`);
    compose(['config', '--quiet'], { NODUS_VERSION: target });
    console.log('  config --quiet: ок');
    return;
  }

  if (current !== true) writeVersion(envPath, envText, target);

  try {
    compose(['config', '--quiet']);
    compose(['pull', 'web', 'api', 'gateway']);
    compose(['up', '-d']);
  } catch (error) {
    if (current !== true && previous) restoreVersion(envPath, target, previous);
    logDeploy(prod, { version: target, previous, status: 'fail', note: 'config/pull/up' });
    fail(
      `выкатка ${target} не удалась: ${error.message}. Откат: --version ${previous || '<прежняя>'}`,
    );
  }

  const unhealthy = waitHealthy();
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

  const smokeArgs = [join(repoDir, 'scripts/prod-smoke.mjs')];
  if (smokeBase) smokeArgs.push('--base', String(smokeBase));
  try {
    execFileSync('node', smokeArgs, { stdio: 'inherit', cwd: repoDir });
  } catch {
    logDeploy(prod, { version: target, previous, status: 'fail', note: 'смок' });
    fail(
      `смок красный — выкатка ${target} не принята. Откат: node scripts/prod-deploy.mjs --version ${previous || '<прежняя>'}`,
    );
  }

  logDeploy(prod, { version: target, previous, status: 'ok', note: digests() });
  console.log(`prod-deploy: версия ${target} на проде`);
}

function ensureKit({ repoDir, prod, tag }) {
  const kitDir = join(prod, 'kit', tag);
  const files = ['docker-compose.yml', 'compose.prod.yaml'];
  const sources = new Map();
  try {
    execFileSync('git', ['-C', repoDir, 'cat-file', '-e', `${tag}^{commit}`], { stdio: 'ignore' });
  } catch {
    execFileSync('git', ['-C', repoDir, 'fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], {
      stdio: 'inherit',
    });
  }
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
  if (existsSync(kitDir)) {
    for (const file of files) {
      const current = readFileSync(join(kitDir, file));
      if (!current.equals(sources.get(file))) {
        fail(
          `kit ${kitDir} расходится с тегом ${tag} (${file}) — каталог kit не редактируется вручную`,
        );
      }
    }
    return kitDir;
  }
  mkdirSync(kitDir, { recursive: true });
  for (const file of files) writeFileSync(join(kitDir, file), sources.get(file));
  return kitDir;
}

function writeVersion(envPath, envText, version) {
  const next = replaceEnvValue(envText, 'NODUS_VERSION', version);
  const tmp = `${envPath}.tmp`;
  writeFileSync(tmp, next);
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows: права через chmod не задаются — не критично для локального прода.
  }
  renameSync(tmp, envPath);
}

function restoreVersion(envPath, version, previous) {
  writeVersion(envPath, readFileSync(envPath, 'utf8'), previous);
  console.warn(`prod-deploy: .env возвращён на ${previous} (выкатка ${version} не дошла до up)`);
}

function waitHealthy() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let unhealthy = SERVICES.slice();
  while (Date.now() < deadline) {
    unhealthy = SERVICES.filter((name) => health(name) !== 'healthy');
    if (unhealthy.length === 0) return [];
    sleep(5_000);
  }
  return unhealthy;
}

function health(name) {
  try {
    return execFileSync(
      'docker',
      [
        'inspect',
        name,
        '--format',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
      ],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return 'missing';
  }
}

function digests() {
  return SERVICES.map((name) => {
    const image = { nodus_web: 'web', nodus_api: 'api', nodus_gateway: 'gateway' }[name];
    try {
      const digest = execFileSync(
        'docker',
        [
          'image',
          'inspect',
          `ghcr.io/passat-project/nodus-${image}`,
          '--format',
          '{{index .RepoDigests 0}}',
        ],
        { encoding: 'utf8' },
      ).trim();
      return `${image}=${digest}`;
    } catch {
      return `${image}=?`;
    }
  }).join(' ');
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

function sleep(ms) {
  execFileSync('node', ['-e', `setTimeout(()=>{}, ${ms})`]);
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
