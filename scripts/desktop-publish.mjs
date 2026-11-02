#!/usr/bin/env node
// Выкладка выпуска оболочки на сервер портала (#562): единственный способ
// положить установщики в раздачу. Ручное копирование файлов запрещено —
// именно оно давало подписи без version: (инцидент 1.0.7/1.0.8) и перезапись
// уже выпущенных версий.
//
//   node scripts/desktop-publish.mjs --run <id> --dest <dir> [--dry-run]
//   node scripts/desktop-publish.mjs --from <dir> --dest <dir> [--dry-run]
//
// --run забирает артефакт прогона desktop-release.yml (gh run download),
// --from берёт уже скачанный каталог. Раскладка: <dest>/releases/<версия>/ +
// <dest>/latest.json (атомарно: tmp → rename). Версия не перезаписывается:
// новая версия — новый каталог и поднятая версия в tauri.conf.json.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRelease } from './lib/desktop-release.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));

try {
  publish(args);
} catch (error) {
  fail(error.message);
}

function publish({ run, from, dest, dryRun }) {
  if (!dest) fail('укажите --dest <каталог раздачи>, например D:/NodusProd/desktop');
  const destDir = resolve(String(dest));
  const sourceDir = resolveSource({ run, from });
  const { manifest, files, sigs } = readRelease(sourceDir);
  const pubkeyB64 = JSON.parse(
    readFileSync(resolve(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
  ).plugins.updater.pubkey;
  const currentVersion = readCurrentVersion(destDir);

  const errors = validateRelease({ manifest, files, sigs, pubkeyB64, currentVersion });
  if (errors.length > 0) {
    console.error(`desktop-publish: выпуск отвергнут (${errors.length}):`);
    for (const error of errors) console.error(`  ✗ ${error}`);
    process.exit(1);
  }

  const version = manifest.version;
  const releaseDir = join(destDir, 'releases', version);
  if (existsSync(releaseDir)) {
    fail(`версия ${version} уже выпущена (${releaseDir}) — поднимите version в tauri.conf.json`);
  }

  if (dryRun) {
    console.log(`desktop-publish: проверки пройдены (dry-run), версия ${version}`);
    console.log(`  файлы: ${installerNames(manifest).join(', ')}`);
    console.log(`  будет создан ${releaseDir} и обновлён ${join(destDir, 'latest.json')}`);
    return;
  }

  mkdirSync(releaseDir, { recursive: true });
  for (const name of installerNames(manifest)) {
    for (const file of [name, `${name}.sig`]) {
      const target = join(releaseDir, file);
      copyFileSync(join(sourceDir, file), target);
      const expected = files[file] ?? statSync(join(sourceDir, file)).size;
      const actual = statSync(target).size;
      if (actual !== expected) fail(`копия ${file} повреждена: ${actual} байт вместо ${expected}`);
    }
  }

  // Байты источника без переформатирования: nginx sub_filter ждёт минифицированный JSON.
  const tmpManifest = join(destDir, 'latest.json.tmp');
  writeFileSync(tmpManifest, readFileSync(join(sourceDir, 'latest.json')));
  renameSync(tmpManifest, join(destDir, 'latest.json'));

  console.log(`desktop-publish: версия ${version} выложена в ${releaseDir}`);
  console.log(`  манифест: ${join(destDir, 'latest.json')}`);
  console.log('  дальше: node scripts/prod-smoke.mjs --desktop-version ' + version);
}

function resolveSource({ run, from }) {
  if (run && from) fail('укажите что-то одно: --run <id> или --from <каталог>');
  if (!run && !from) fail('укажите источник: --run <id> или --from <каталог>');
  if (from) {
    const dir = resolve(String(from));
    if (!existsSync(dir)) fail(`каталог выпуска не найден: ${dir}`);
    return dir;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'nodus-desktop-'));
  execFileSync('gh', ['run', 'download', String(run), '-D', tmp], { stdio: 'inherit' });
  const dirs = readdirSync(tmp, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^nodus-desktop-release-/.test(entry.name))
    .map((entry) => entry.name);
  if (dirs.length !== 1) {
    fail(`в прогоне ${run} ожидался один артефакт nodus-desktop-release-*, найдено ${dirs.length}`);
  }
  return join(tmp, dirs[0]);
}

function readRelease(sourceDir) {
  const manifestPath = join(sourceDir, 'latest.json');
  if (!existsSync(manifestPath)) fail(`в ${sourceDir} нет latest.json — это не каталог выпуска`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`latest.json не разбирается: ${error.message}`);
  }
  const files = {};
  const sigs = {};
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'latest.json') continue;
    files[entry.name] = statSync(join(sourceDir, entry.name)).size;
    if (entry.name.endsWith('.sig')) {
      sigs[entry.name] = readFileSync(join(sourceDir, entry.name), 'utf8');
    }
  }
  return { manifest, files, sigs };
}

function readCurrentVersion(destDir) {
  const path = join(destDir, 'latest.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')).version;
  } catch (error) {
    fail(`текущий ${path} не разбирается: ${error.message}`);
  }
}

function installerNames(manifest) {
  const urls = Object.values(manifest.platforms ?? {}).map((entry) => String(entry?.url ?? ''));
  return [...new Set(urls.map((url) => url.split('/').pop()).filter(Boolean))];
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
  console.error(`desktop-publish: ${message}`);
  process.exit(1);
}
