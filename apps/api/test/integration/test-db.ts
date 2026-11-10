import { execSync } from 'node:child_process';
import pg from 'pg';
import { assertIsolatedTestEnv } from '@nodus/config/test-env';

/** Имя тестовой БД: по умолчанию общая `nodus_test`; отдельная копия
 *  (например, `nodus_test_556`) задаётся env `TEST_DB_NAME` — параллельные
 *  сессии не ломают друг другу прогоны. */
export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'nodus_test';
if (!/^[a-z_][a-z0-9_]*$/i.test(TEST_DB_NAME)) {
  throw new Error(`TEST_DB_NAME «${TEST_DB_NAME}» — недопустимое имя базы (буквы, цифры, _)`);
}

/** URL тестовой БД (nodus_test) на том же сервере, что и DATABASE_URL. */
export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL не задан — интеграционные тесты требуют PostgreSQL');
  }
  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

/**
 * Изоляция общего каталога между наборами (#524): публикация системного
 * маршрута ставит `customizedAt`, и `seedOnce` («засев один раз») больше не
 * перетирает каталог — следующий набор видит форму окна прошлого набора.
 * Перед каждым набором снимаем признак кастомизации и ревизию у ЗАТРОНУТЫХ
 * системных сущностей: `onApplicationBootstrap` заново применит каталог
 * (чистые сущности не трогаем — лишних событий и записей не будет).
 */
async function resetCustomizedSystemCatalog(testUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    await client.query(
      `UPDATE workflows SET customized_at = NULL, catalog_revision = 0
        WHERE is_system = true AND customized_at IS NOT NULL`,
    );
    await client.query(
      `UPDATE process_types SET customized_at = NULL
        WHERE is_system = true AND customized_at IS NOT NULL`,
    );
  } finally {
    await client.end();
  }
}

/**
 * Готовит тестовую БД: создаёт nodus_test при отсутствии и применяет миграции.
 * Идемпотентно — вызывается в beforeAll каждого набора, работающего с БД.
 */
export async function ensureTestDatabase(appRoot: string): Promise<string> {
  assertIsolatedTestEnv();
  const testUrl = testDatabaseUrl();
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DB_NAME,
    ]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    }
  } finally {
    await admin.end();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
  await resetCustomizedSystemCatalog(testUrl);
  return testUrl;
}
