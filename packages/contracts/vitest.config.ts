import { defineConfig } from 'vitest/config';

/** Unit-тесты контрактов; покрытие — храповик на замерах 03.11.2026 (#593). */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        statements: 72,
        branches: 80,
        functions: 78,
        lines: 71,
      },
    },
  },
});
