// I/O-помощники выкатки прода (#565): git, docker, окружение. Отдельный модуль,
// чтобы scripts/prod-deploy.mjs держался в лимите размера файла (I5).

import { execFileSync } from 'node:child_process';

// Якорь доверия: фиксированный URL репозитория, а не имя remote клона.
const REPO_URL = 'https://github.com/passat-project/nodus';

/** Вывод git-команды без хвостовых переводов строки. */
export function gitOut(repoDir, args) {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim();
}

/** Коммит тега на origin (для annotated-тега — разыменованный). */
export function remoteTagCommit(repoDir, tag) {
  // Фиксированный URL, а не имя remote: у чужого клона `--repo` «origin»
  // указывает на его репозиторий, и сверка прошла бы сама с собой.
  const deref = gitOut(repoDir, ['ls-remote', REPO_URL, `refs/tags/${tag}^{}`]);
  const plain = deref || gitOut(repoDir, ['ls-remote', REPO_URL, `refs/tags/${tag}`]);
  return plain ? plain.split(/\s+/)[0] : '';
}

/**
 * Коммит локального тега с проверкой, что на origin он не перемещён:
 * перемещённый тег разводит kit (compose-файлы) и образы, собранные CI.
 * `offline: true` (перезапуск текущей версии после перезагрузки) — сетевая
 * сверка best-effort: kit уже сверен с `.env` побайтово, образы проверяются
 * по локальным label; без сети прод всё равно должен подняться.
 */
export function resolveTagCommit(repoDir, tag, { offline = false } = {}) {
  let commit;
  try {
    commit = gitOut(repoDir, ['rev-parse', `${tag}^{commit}`]);
  } catch {
    execFileSync('git', ['-C', repoDir, 'fetch', REPO_URL, `refs/tags/${tag}:refs/tags/${tag}`], {
      stdio: 'inherit',
    });
    commit = gitOut(repoDir, ['rev-parse', `${tag}^{commit}`]);
  }
  let remote;
  try {
    remote = remoteTagCommit(repoDir, tag);
  } catch (error) {
    if (!offline) throw error;
    console.warn(`prod-deploy: origin недоступен (${error.message}) — сверка тега пропущена`);
    return commit;
  }
  if (!remote) {
    if (offline) return commit;
    throw new Error(
      `тег ${tag} не найден на ${REPO_URL} — сверка целостности невозможна, выкатка остановлена`,
    );
  }
  if (remote !== commit) {
    throw new Error(
      `тег ${tag} на origin указывает на ${remote}, а локально на ${commit}: тег перемещён — kit и образы могут разойтись, выкатка остановлена`,
    );
  }
  return commit;
}

/**
 * Окружение для `docker compose`: только системные ключи. Shell-env
 * приоритетнее `--env-file`, поэтому экспортированные NODUS_… и COMPOSE_…
 * у оператора молча увели бы на прод другую версию или registry.
 *
 * ProgramFiles обязателен: Docker CLI ищет cli-plugins в
 * `%ProgramFiles%\Docker\cli-plugins`, и без него на Windows-хосте
 * `docker compose` отвечает «unknown command: docker compose» (проверено
 * живым прогоном на хосте прода, code-review #565).
 */
export function sanitizeEnv(base = process.env) {
  const keep = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'SystemDrive',
    'WINDIR',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramW6432',
    'ProgramData',
    'APPDATA',
    'LOCALAPPDATA',
    'PUBLIC',
    'TEMP',
    'TMP',
    'COMSPEC',
    'PATHEXT',
  ];
  const out = {};
  for (const key of keep) {
    if (base[key] !== undefined) out[key] = base[key];
  }
  return out;
}

/** Значение label образа (например, revision сборки). */
export function imageLabel(ref, name) {
  return execFileSync(
    'docker',
    ['image', 'inspect', ref, '--format', `{{index .Config.Labels "${name}}"}}`],
    {
      encoding: 'utf8',
    },
  ).trim();
}

/** RepoDigest трёх образов версии: `{ web, api, gateway }` (для журнала и сверки). */
export function repoDigests(registry, target, services) {
  const out = {};
  for (const { image } of services) {
    try {
      out[image] = execFileSync(
        'docker',
        [
          'image',
          'inspect',
          `${registry}/nodus-${image}:${target}`,
          '--format',
          '{{index .RepoDigests 0}}',
        ],
        { encoding: 'utf8' },
      ).trim();
    } catch {
      out[image] = '';
    }
  }
  return out;
}

/** Строка журнала: digest трёх образов версии. */
export function digests(registry, target, services) {
  const map = repoDigests(registry, target, services);
  return services.map(({ image }) => `${image}=${map[image] || '?'}`).join(' ');
}

/** Статус health контейнера: healthy / starting / unhealthy / missing. */
export function health(name) {
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

/** Ждёт healthy у всех сервисов; возвращает список отставших. */
export function waitHealthy(services, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let unhealthy = services.slice();
  while (Date.now() < deadline) {
    unhealthy = services.filter((name) => health(name) !== 'healthy');
    if (unhealthy.length === 0) return [];
    sleep(5_000);
  }
  return unhealthy;
}

export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
