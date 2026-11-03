import { config as loadEnv } from 'dotenv';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { isolateIntegrationEnv } from '@nodus/config/test-env';

// Интеграционным тестам нужны DATABASE_URL/REDIS_URL — подхватываем корневой .env.
loadEnv({ path: new URL('../../.env', import.meta.url) });
// Redis и бакет хранилища тест-контура — свои, не живого стека из .env (#332, #324).
isolateIntegrationEnv();

/**
 * Интеграционные тесты (patterns.md): реальные PostgreSQL/Redis, не моки.
 * Локально — docker-контейнеры nodus_*; CI — service-контейнеры.
 * Требуют env DATABASE_URL и REDIS_URL (иначе наборы скипаются).
 * SWC — потому что oxc/rolldown не эмитит decorator metadata, нужную Nest DI.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Общая тестовая БД — файлы последовательно, без параллелизма.
    pool: 'forks',
    maxWorkers: 1,
    maxConcurrency: 1,
    sequence: { concurrent: false },
    // Отдельный отчёт (#596): diff coverage объединяет unit + integration,
    // иначе код, покрытый только интеграционными тестами, ложно краснел бы.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage-integration',
    },
  },
});
