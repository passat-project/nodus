import { defineConfig } from 'vitest/config';

/**
 * Unit-тесты (Vitest): рядом с кодом, без инфраструктуры.
 * Интеграционные (test/integration, Nest-приложение через SWC, реальные
 * PG/Redis) — отдельный конфиг `vitest.integration.config.ts`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Покрытие (#593): пороги — храповик на замерах 03.11.2026, ниже — CI красный.
    // Интеграционный набор (test/integration) считается отдельным слоем и сюда не входит.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      thresholds: {
        statements: 53,
        branches: 49,
        functions: 40,
        lines: 55,
      },
    },
  },
});
