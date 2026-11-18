/**
 * Предохранитель хостовых Prisma-команд (#943, инцидент 18.11.2026):
 * корневой `.env` указывает `DATABASE_URL` на ПРОД-БД `nodus` (опубликованный
 * порт `nodus_postgres`, working_dir `D:\NodusProd`), поэтому `prisma db
 * execute`/`migrate dev` с хоста молча пишут в прод. Песочница использует
 * `nodus_night` через live-stack, CI/прод-выкатка — `migrate deploy` в
 * контейнере; интерактивные и ad-hoc команды на проде запрещены.
 *
 * `migrate deploy`, `generate`, `status`, `diff` не блокируются: это штатные
 * пути выкатки и проверки. В CI (`CI=true`) проверка отключена: там БД —
 * эфемерный сервис-контейнер, а не прод.
 *
 * Источники: Prisma docs прямо требуют «migrate dev never in production» и
 * направляют прод-выкатку через `migrate deploy`, но не дают встроенной
 * защиты (prisma.io/docs/cli/v7/migrate/dev); Rails решает ту же задачу
 * ProtectedEnvironmentError — защищённое окружение + явный escape-hatch env
 * var (api.rubyonrails.org ActiveRecord::Tasks::DatabaseTasks); GitHub Actions
 * документирует `CI=true` как штатный признак «это не локальная машина»
 * (docs.github.com/en/actions/reference/workflows-and-actions/variables).
 */

const MUTATING_COMMANDS: readonly (readonly [string, string])[] = [
  ['migrate', 'dev'],
  ['migrate', 'reset'],
  ['migrate', 'push'],
  ['db', 'execute'],
  ['db', 'push'],
  ['db', 'seed'],
];

/** Признак CI: там БД — эфемерный сервис-контейнер, прод не затрагивается. */
export function isCiEnvironment(env: NodeJS.ProcessEnv | undefined): boolean {
  return env?.CI === 'true' || env?.CI === '1';
}

/** Имя БД из URL (без параметров); null — URL не разобрался. */
export function databaseName(url: string): string | null {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, '');
    return name || null;
  } catch {
    return null;
  }
}

/** Опасная команда Prisma: первые два не-флаговых токена argv. */
export function isMutatingPrismaCommand(argv: readonly string[]): boolean {
  const tokens = argv.filter((token) => !token.startsWith('-')).slice(0, 2);
  return MUTATING_COMMANDS.some(([command, sub]) => tokens[0] === command && tokens[1] === sub);
}

/**
 * Проверка цели: возвращает текст ошибки для блокировки или null.
 * `ALLOW_PROD_DB=1` — осознанный обход (только для владельца/аварий).
 */
export function assertSafeDbTarget(params: {
  url: string;
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
}): string | null {
  // В CI БД — сервис-контейнер GitHub Actions (тоже называется `nodus`),
  // живёт минуты и удаляется вместе с джобом: прод там недостижим.
  if (isCiEnvironment(params.env)) return null;
  if (databaseName(params.url) !== 'nodus') return null;
  if (!isMutatingPrismaCommand(params.argv)) return null;
  if (params.env?.ALLOW_PROD_DB === '1') return null;
  return [
    'STOP: DATABASE_URL указывает на ПРОД-БД «nodus» (nodus_postgres, D:\\NodusProd).',
    'Хостовая Prisma-команда изменила бы прод. Для песочницы используй nodus_night',
    '(pnpm live-stack up), для выкатки — migrate deploy в контейнере.',
    'Осознанный обход: ALLOW_PROD_DB=1.',
  ].join(' ');
}
