import { defineConfig } from 'vitest/config';

/** Юнит-тесты gateway; интеграционные (живые PG/Redis) — отдельный конфиг. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Покрытие (#593): пороги — храповик на замерах 03.11.2026, ниже — CI красный.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      thresholds: {
        statements: 63,
        branches: 64,
        functions: 48,
        lines: 63,
      },
    },
  },
});
