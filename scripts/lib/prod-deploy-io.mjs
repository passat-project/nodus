// I/O-помощники выкатки прода (#565): git, docker, окружение. Отдельный модуль,
// чтобы scripts/prod-deploy.mjs держался в лимите размера файла (I5).

import { execFileSync } from 'node:child_process';

/** Вывод git-команды без хвостовых переводов строки. */
export function gitOut(repoDir, args) {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim();
}

/** Коммит тега на origin (для annotated-тега — разыменованный). */
export function remoteTagCommit(repoDir, tag) {
  const deref = gitOut(repoDir, ['ls-remote', 'origin', `refs/tags/${tag}^{}`]);
  const plain = deref || gitOut(repoDir, ['ls-remote', 'origin', `refs/tags/${tag}`]);
  return plain ? plain.split(/\s+/)[0] : '';
}

/**
 * Коммит локального тега с проверкой, что на origin он не перемещён:
 * перемещённый тег разводит kit (compose-файлы) и образы, собранные CI.
 */
export function resolveTagCommit(repoDir, tag) {
  let commit;
  try {
    commit = gitOut(repoDir, ['rev-parse', `${tag}^{commit}`]);
  } catch {
    execFileSync('git', ['-C', repoDir, 'fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], {
      stdio: 'inherit',
    });
    commit = gitOut(repoDir, ['rev-parse', `${tag}^{commit}`]);
  }
  const remote = remoteTagCommit(repoDir, tag);
  if (remote && remote !== commit) {
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
 */
export function sanitizeEnv(base = process.env) {
  const keep = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'COMSPEC',
    'PATHEXT',
    'DOCKER_HOST',
    'DOCKER_CONFIG',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
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

/** Строка журнала: digest трёх образов версии. */
export function digests(registry, target, services) {
  return services
    .map(({ image }) => {
      try {
        const digest = execFileSync(
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
        return `${image}=${digest}`;
      } catch {
        return `${image}=?`;
      }
    })
    .join(' ');
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
