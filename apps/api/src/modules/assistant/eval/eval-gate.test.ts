import { describe, expect, it } from 'vitest';

import { evalCatalog } from './catalog.js';
import { runEval } from './eval-runner.js';
import { summaryLine } from './eval-report.js';
import { GOLDEN_SET } from './golden/index.js';

/**
 * Eval-гейт каталога (#926, этап 1): гоняется в CI и перед каждой партией
 * инструментов. Партия, ухудшающая числа, не мержится.
 *
 * Пороги: recall@7 ≥ 90%, неверный инструмент < 5%, корректный отказ ≥ 95%,
 * безопасное уточнение ≥ 90%. Модель не нужна: симулятор диспетчера и
 * lexical search детерминированы.
 */

export const EVAL_THRESHOLDS = {
  recallAt7: 0.9,
  wrongToolRate: 0.05,
  refusalAccuracy: 0.95,
  clarifySafety: 0.9,
} as const;

const result = runEval(evalCatalog(), GOLDEN_SET);

describe('eval каталога: гейт', () => {
  it('печатает сводку прогона', () => {
    console.log(summaryLine(result));
    console.log(
      `кейсов ${result.caseCount}: с инструментами ${result.supportedCount}, отказ ${result.noToolCount}, уточнение ${result.clarifyCount}`,
    );
    expect(result.caseCount).toBe(GOLDEN_SET.length);
  });

  it('recall@7 не ниже 90% (диспетчер)', () => {
    expect(result.router.recallAt7).toBeGreaterThanOrEqual(EVAL_THRESHOLDS.recallAt7);
  });

  it('recall@7 не ниже 90% (tools.search)', () => {
    expect(result.search.recallAt7).toBeGreaterThanOrEqual(EVAL_THRESHOLDS.recallAt7);
  });

  it('неверный инструмент реже 5% (диспетчер)', () => {
    // tools.search — кандидаты второй полки, а не решение: неверный инструмент
    // там ожидаем и отсекается моделью/диспетчером.
    expect(result.router.wrongToolRate).toBeLessThan(EVAL_THRESHOLDS.wrongToolRate);
  });

  it('корректный отказ не ниже 95%', () => {
    expect(result.router.refusalAccuracy).toBeGreaterThanOrEqual(EVAL_THRESHOLDS.refusalAccuracy);
  });

  it('уточнение без записи не ниже 90%', () => {
    expect(result.router.clarifySafety).toBeGreaterThanOrEqual(EVAL_THRESHOLDS.clarifySafety);
  });
});
