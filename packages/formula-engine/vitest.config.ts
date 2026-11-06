import { defineConfig } from 'vitest/config';

/** Unit-тесты движка формул (#632): типы, null-семантика, деньги, циклы,
 *  ошибки ячейки. Пороги покрытия — общий храповик CI (diff coverage). */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
