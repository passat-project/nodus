/**
 * Параметры пула соединений PostgreSQL для PrismaPg (AUD-022).
 *
 * Единственная точка умолчаний: их же подставляет `config/env.schema.ts`
 * (валидация на старте) и `docker-compose.yml` (проводка в контейнер api).
 * Точный подбор значений под нагрузку — #473, здесь только разумные дефолты:
 * пул 20 на один процесс api, ожидание соединения 5 с (не «вечно», иначе
 * запрос висит без ответа), простой 10 с (умолчание pg), statement_timeout
 * 30 с (дольше — уже аварийный запрос; миграции идут отдельным клиентом).
 */
export const DATABASE_POOL_DEFAULTS = {
  max: 20,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 10_000,
  statementTimeoutMs: 30_000,
} as const;

/** Опции, которые понимает PrismaPg (pg.PoolConfig) и передаёт в пул. */
export interface DatabasePoolOptions {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statement_timeout: number;
}

/** Непустая строка → положительное целое, иначе умолчание. Кривое значение
 *  в проде отсекает validateEnv до создания пула; здесь — безопасный фолбэк
 *  для тестов, где PrismaService создаётся напрямую. */
function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function databasePoolOptions(env: NodeJS.ProcessEnv = process.env): DatabasePoolOptions {
  return {
    max: positiveInt(env.DATABASE_POOL_MAX, DATABASE_POOL_DEFAULTS.max),
    connectionTimeoutMillis: positiveInt(
      env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      DATABASE_POOL_DEFAULTS.connectionTimeoutMillis,
    ),
    idleTimeoutMillis: positiveInt(
      env.DATABASE_POOL_IDLE_TIMEOUT_MS,
      DATABASE_POOL_DEFAULTS.idleTimeoutMillis,
    ),
    statement_timeout: positiveInt(
      env.DATABASE_STATEMENT_TIMEOUT_MS,
      DATABASE_POOL_DEFAULTS.statementTimeoutMs,
    ),
  };
}
