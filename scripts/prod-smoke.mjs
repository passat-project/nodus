#!/usr/bin/env node
// Смок прода (#562, Р14): обязательный шаг каждой выкатки. Проверяет то, что
// тихо ломалось 27.10–02.11: раздачу оболочки. Тогда портал отдавал 404 на
// /desktop/latest.json, кнопка «Скачать приложение» молча исчезала, оболочки
// не видели обновлений — и старый смок этого не замечал.
//
//   node scripts/prod-smoke.mjs [--base https://nodus.by]
//        [--api http://localhost:3001 | --no-api]
//        [--desktop-version X.Y.Z] [--allow-no-desktop]
//
// --allow-no-desktop — для порталов без раздачи оболочки (клиентские коробки
// без десктопа): 404 манифеста тогда не ошибка, а пропуск.

const args = parseArgs(process.argv.slice(2));
const base = String(args.base ?? 'https://nodus.by').replace(/\/+$/, '');
const api = String(args.api ?? 'http://localhost:3001').replace(/\/+$/, '');
const expectedVersion = args.desktopVersion ? String(args.desktopVersion) : null;
const allowNoDesktop = args.allowNoDesktop === true;
const checkApi = args.noApi !== true;
const MIN_INSTALLER_BYTES = 1024 * 1024;

const results = [];
await checkMainPage();
if (checkApi) await checkApiHealth();
await checkDesktop();

printTable();
process.exit(results.some((result) => !result.ok) ? 1 : 0);

async function checkMainPage() {
  const response = await request(base);
  if (!response.ok) return;
  const type = response.headers.get('content-type') ?? '';
  record(
    'главная страница',
    response.status === 200 && type.includes('text/html'),
    `HTTP ${response.status}, ${type}`,
  );
}

async function checkApiHealth() {
  const response = await request(`${api}/api/v1/health`);
  if (!response.ok) return;
  const status = await response
    .json()
    .then((body) => body.status)
    .catch(() => null);
  record(
    'api: health',
    response.status === 200 && status === 'ok',
    `HTTP ${response.status}, status ${status ?? '—'}`,
  );
}

async function checkDesktop() {
  const manifestUrl = `${base}/desktop/latest.json`;
  const response = await request(manifestUrl);
  if (!response.ok) return;

  if (response.status === 404 && allowNoDesktop) {
    results.push({
      name: 'раздача оболочки',
      ok: true,
      detail: 'манифеста нет — пропущено (--allow-no-desktop)',
    });
    return;
  }

  const manifest = await response.json().catch(() => null);
  const versionOk = Boolean(manifest?.version);
  const versionMatches = !expectedVersion || manifest?.version === expectedVersion;
  record(
    'манифест оболочки',
    response.status === 200 && versionOk && versionMatches,
    `HTTP ${response.status}, version ${manifest?.version ?? '—'}${
      expectedVersion ? ` (ожидалась ${expectedVersion})` : ''
    }`,
  );

  const nsis = manifest?.platforms?.['windows-x86_64-nsis'];
  const url = String(nsis?.url ?? '');
  const absolute = /^https?:\/\//.test(url);
  record(
    'манифест: NSIS-URL',
    Boolean(nsis) && absolute,
    nsis ? url : 'нет платформы windows-x86_64-nsis',
  );
  if (!absolute) return;

  const installer = await request(url);
  if (!installer.ok) return;
  const size = await installer
    .arrayBuffer()
    .then((buffer) => buffer.byteLength)
    .catch(() => 0);
  record(
    'установщик скачивается',
    installer.status === 200 && size > MIN_INSTALLER_BYTES,
    `HTTP ${installer.status}, ${(size / 1024 / 1024).toFixed(1)} МБ`,
  );
}

async function request(url) {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    return {
      ok: true,
      status: response.status,
      headers: response.headers,
      json: () => response.json(),
      arrayBuffer: () => response.arrayBuffer(),
    };
  } catch (error) {
    record(new URL(url).pathname, false, error.message);
    return { ok: false };
  }
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
}

function printTable() {
  const width = Math.max(...results.map((result) => result.name.length));
  console.log(`prod-smoke: ${base}`);
  for (const result of results) {
    console.log(`  ${result.ok ? '✓' : '✗'} ${result.name.padEnd(width)}  ${result.detail}`);
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(
    failed === 0 ? '  итог: всё зелёное' : `  итог: ${failed} из ${results.length} — ПРОВАЛ`,
  );
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
