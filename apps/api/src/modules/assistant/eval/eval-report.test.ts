import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BASELINE } from './baseline.js';
import { evalCatalog } from './catalog.js';
import { runEval } from './eval-runner.js';
import { EVAL_REPORT_MARKER, renderEvalReport } from './eval-report.js';
import { GOLDEN_BASE_SET, GOLDEN_SET } from './golden/index.js';

/**
 * Свежесть отчёта eval (#926): `docs/architecture/assistant-eval-report.md`
 * генерируется из прогона, руками не правится. Числа «до» — замер baseline
 * (`baseline.ts`), «после» на том же срезе — прогон исходных 100 кейсов.
 */

const REPORT_PATH = fileURLToPath(
  new URL('../../../../../../docs/architecture/assistant-eval-report.md', import.meta.url),
);

const result = runEval(evalCatalog(), GOLDEN_SET);
const baseResult = runEval(evalCatalog(), GOLDEN_BASE_SET);
const report = renderEvalReport(result, {
  baseline: BASELINE,
  baselineCurrent: baseResult,
  generatedFrom: 'каталог ветки #926 (партии #927–#932); золотой набор `eval/golden`',
});

describe('assistant-eval-report.md: сгенерированный отчёт (#926)', () => {
  it('содержит маркер генерации и числа до/после', () => {
    expect(report).toContain(EVAL_REPORT_MARKER);
    expect(report).toContain('До (baseline)');
    expect(report).toContain('После (тот же срез)');
  });

  it('совпадает с генерацией (UPDATE_ASSISTANT_EVAL_REPORT=1)', () => {
    if (process.env.UPDATE_ASSISTANT_EVAL_REPORT === '1') {
      writeFileSync(REPORT_PATH, report);
      return;
    }
    const current = existsSync(REPORT_PATH) ? readFileSync(REPORT_PATH, 'utf8') : '';
    expect(
      current,
      'отчёт устарел: UPDATE_ASSISTANT_EVAL_REPORT=1 pnpm --filter @nodus/api exec vitest run src/modules/assistant/eval/eval-report.test.ts',
    ).toBe(report);
  });
});
