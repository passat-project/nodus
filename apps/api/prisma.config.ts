import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

import { assertSafeDbTarget } from './src/core/database/db-target-guard.js';

// Prisma 7 не загружает .env сам; корневой .env монорепо — единая точка секретов.
config({ path: '../../.env' });

// `generate` не коннектится к БД, но config обязан содержать url — в docker
// build (без .env) подставляется заглушка. Миграции требуют реальный
// DATABASE_URL (из .env на хосте / env в CI) и на заглушке упадут.
const datasourceUrl =
  process.env.DATABASE_URL ??
  'postgresql://generate-only:generate-only@localhost:5432/generate-only';

// Инцидент 18.11.2026: `prisma db execute` с хоста применил миграцию к
// прод-БД `nodus` (корневой .env смотрит на published-порт nodus_postgres).
// Блокируем интерактивные/ad-hoc команды; `migrate deploy` (штатная выкатка)
// и `generate/status/diff` проходят.
const blocked = assertSafeDbTarget({
  url: datasourceUrl,
  argv: process.argv.slice(2),
  env: process.env,
});
if (blocked) {
  console.error(blocked);
  process.exit(1);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Демо-оргструктура (ADR-0002): идемпотентный upsert-сеед.
    // `node --import tsx` — кроссплатформенно (host Windows + docker-контейнер,
    // где pnpm-бины не на PATH).
    seed: 'node --import tsx prisma/seed.ts',
  },
  datasource: {
    url: datasourceUrl,
  },
});
