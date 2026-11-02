#!/usr/bin/env node
// Выкладка выпуска оболочки на сервер портала (#562): единственный способ
// положить установщики в раздачу. Ручное копирование файлов запрещено —
// именно оно давало подписи без version: (инцидент 1.0.7/1.0.8) и перезапись
// уже выпущенных версий.
//
//   node scripts/desktop-publish.mjs --run <id> --dest <dir> [--dry-run]
//   node scripts/desktop-publish.mjs --from <dir> --dest <dir> [--dry-run]
//
// --run забирает артефакт прогона desktop-release.yml (gh run download) и
// сверяет, что это действительно успешный прогон релизного workflow с main:
// скачать артефакт любого прогона репозитория — не то же самое, что выпустить
// релиз. --from берёт уже скачанный каталог. Раскладка: <dest>/releases/<версия>/
// (каталог собирается в staging и переименовывается целиком) + <dest>/latest.json
// (tmp → rename). Версия не перезаписывается: новая версия — новый каталог и
// поднятая версия в tauri.conf.json.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { releaseFileNames, validateRelease } from './lib/desktop-release.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));

// Временный каталог под скачанный артефакт живёт до конца команды: иначе на
// сервере прода копится по ~15 МБ с каждого выпуска.
let tempDir = null;
try {
  tempDir = publish(args);
} catch (error) {
  console.error(`desktop-publish: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}

function publish({ run, from, dest, dryRun }) {
  if (!dest) fail('укажите --dest <каталог раздачи>, например D:/NodusProd/desktop');
  const destDir = resolve(String(dest));
  const source = resolveSource({ run, from });
  const { manifest, files, sigs, contents } = readRelease(source.dir);
  const pubkeyB64 = JSON.parse(
    readFileSync(resolve(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
  ).plugins.updater.pubkey;
  const currentVersion = readCurrentVersion(destDir);

  const errors = validateRelease({ manifest, files, sigs, pubkeyB64, currentVersion, contents });
  if (errors.length > 0) {
    console.error(`desktop-publish: выпуск отвергнут (${errors.length}):`);
    for (const error of errors) console.error(`  ✗ ${error}`);
    process.exitCode = 1;
    return source.tempDir;
  }

  const version = manifest.version;
  const names = releaseFileNames(manifest);
  const releaseDir = join(destDir, 'releases', version);
  if (existsSync(releaseDir)) {
    fail(`версия ${version} уже выпущена (${releaseDir}) — поднимите version в tauri.conf.json`);
  }

  if (dryRun) {
    console.log(`desktop-publish: проверки пройдены (dry-run), версия ${version}`);
    console.log(`  файлы: ${names.join(', ')}`);
    console.log(`  будет создан ${releaseDir} и обновлён ${join(destDir, 'latest.json')}`);
    return source.tempDir;
  }

  // Каталог версии собирается в staging и переименовывается целиком: обрыв
  // копирования не оставляет «полувыпущенную» версию, которую потом нельзя
  // перезаписать (версии неизменяемы). Staging — dot-каталог вне releases/:
  // nginx не отдаёт dot-пути раздачи наружу (infra/nginx/web.conf).
  const stagingDir = join(destDir, '.staging', version);
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  try {
    for (const name of names) {
      for (const file of [name, `${name}.sig`]) {
        const target = join(stagingDir, file);
        copyFileSync(join(source.dir, file), target);
        const expected = files[file] ?? statSync(join(source.dir, file)).size;
        const actual = statSync(target).size;
        if (actual !== expected)
          fail(`копия ${file} повреждена: ${actual} байт вместо ${expected}`);
      }
    }
    mkdirSync(join(destDir, 'releases'), { recursive: true });
    renameSync(stagingDir, releaseDir);
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  // Байты источника без переформатирования: nginx sub_filter ждёт минифицированный JSON.
  const tmpManifest = join(releaseDir, '.latest.json.tmp');
  writeFileSync(tmpManifest, readFileSync(join(source.dir, 'latest.json')));
  renameSync(tmpManifest, join(destDir, 'latest.json'));

  console.log(`desktop-publish: версия ${version} выложена в ${releaseDir}`);
  console.log(`  манифест: ${join(destDir, 'latest.json')}`);
  console.log('  дальше: node scripts/prod-smoke.mjs --desktop-version ' + version);
  return source.tempDir;
}

function resolveSource({ run, from }) {
  if (run && from) fail('укажите что-то одно: --run <id> или --from <каталог>');
  if (!run && !from) fail('укажите источник: --run <id> или --from <каталог>');
  if (from) {
    const dir = resolve(String(from));
    if (!existsSync(dir)) fail(`каталог выпуска не найден: ${dir}`);
    return { dir, tempDir: null };
  }
  verifyRun(String(run));
  const tmp = mkdtempSync(join(tmpdir(), 'nodus-desktop-'));
  execFileSync('gh', ['run', 'download', String(run), '-D', tmp], {
    stdio: 'inherit',
    cwd: repoRoot,
  });
  const dirs = readdirSync(tmp, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^nodus-desktop-release-/.test(entry.name))
    .map((entry) => entry.name);
  if (dirs.length !== 1) {
    fail(`в прогоне ${run} ожидался один артефакт nodus-desktop-release-*, найдено ${dirs.length}`);
  }
  return { dir: join(tmp, dirs[0]), tempDir: tmp };
}

function verifyRun(runId) {
  let meta;
  try {
    meta = JSON.parse(
      execFileSync('gh', ['run', 'view', runId, '--json', 'workflowName,headBranch,conclusion'], {
        encoding: 'utf8',
        cwd: repoRoot,
      }),
    );
  } catch (error) {
    fail(`не удалось прочитать прогон ${runId}: ${error.message}`);
  }
  if (meta.workflowName !== 'desktop-release') {
    fail(
      `прогон ${runId} — «${meta.workflowName}», а не desktop-release: чужой артефакт не выкладываем`,
    );
  }
  if (meta.headBranch !== 'main') {
    fail(`прогон ${runId} с ветки «${meta.headBranch}» — выпуск разрешён только с main`);
  }
  if (meta.conclusion !== 'success') {
    fail(`прогон ${runId} не успешен (${meta.conclusion ?? 'идёт'}) — дождитесь success`);
  }
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
  const contents = {};
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === 'latest.json') continue;
    if (entry.isSymbolicLink()) {
      fail(`в выпуске симлинк «${entry.name}» — в раздачу кладутся только настоящие файлы`);
    }
    if (!entry.isFile()) continue;
    const path = join(sourceDir, entry.name);
    files[entry.name] = lstatSync(path).size;
    const bytes = readFileSync(path);
    contents[entry.name] = bytes;
    if (entry.name.endsWith('.sig')) sigs[entry.name] = bytes.toString('utf8');
  }
  return { manifest, files, sigs, contents };
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
