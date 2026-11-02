// Чистые функции выкатки прода (#565, ADR-0036): разбор и правка `.env`,
// проверка абсолютности пути, сборка аргументов compose. Без fs и процессов —
// чтобы правила проверялись юнит-тестами.

/** Разбор `.env` в объект: `KEY=value`, кавычки снимаются, комментарии пропускаются. */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    out[key] = unquote(line.slice(at + 1).trim());
  }
  return out;
}

/** Замена значения в `.env` с сохранением остальных строк; нет ключа — добавить. */
export function replaceEnvValue(text, key, value) {
  const lines = String(text ?? '').split('\n');
  const pattern = new RegExp(`^\\s*${escapeRe(key)}\\s*=`);
  const hits = lines.filter((line) => pattern.test(line));
  if (hits.length > 1) throw new Error(`в .env несколько строк ${key} — оставьте одну`);
  const next = `${key}=${value}`;
  if (hits.length === 0) {
    const body = String(text ?? '');
    return `${body}${body.endsWith('\n') || body === '' ? '' : '\n'}${next}\n`;
  }
  return lines.map((line) => (pattern.test(line) ? next : line)).join('\n');
}

/** Абсолютный путь хоста: `D:/…`, `D:\…` или `/…`. */
export function isAbsoluteHostPath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value ?? '')) || String(value ?? '').startsWith('/');
}

/** Аргументы `docker compose` для прод-каталога и kit'а версии. */
export function buildComposeArgs({ prodDir, kitDir, profiles = [] }) {
  const args = [
    '-p',
    'nodus',
    '--project-directory',
    prodDir,
    '--env-file',
    joinPath(prodDir, '.env'),
    '-f',
    joinPath(kitDir, 'docker-compose.yml'),
    '-f',
    joinPath(kitDir, 'compose.prod.yaml'),
  ];
  for (const profile of profiles) args.push('--profile', profile);
  return args;
}

function joinPath(dir, name) {
  return `${String(dir).replace(/[\\/]+$/, '')}/${name}`;
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
