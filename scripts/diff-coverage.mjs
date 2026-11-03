#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

import {
  collectCoverage,
  computeDiffCoverage,
  formatDiffCoverage,
  parseChangedLines,
} from './lib/diff-coverage.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const base = arg('base', process.env.BASE_REF ? `origin/${process.env.BASE_REF}` : 'origin/main');
const threshold = Number(arg('threshold', '80'));

let table;
try {
  const diff = execFileSync(
    'git',
    ['diff', '--unified=0', '--no-color', `${base}...HEAD`, '--', '*.ts', '*.tsx'],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  const { coverage, packages } = collectCoverage();
  const result = computeDiffCoverage({
    changedLines: parseChangedLines(diff),
    coverage,
    packages,
  });
  table = formatDiffCoverage(result, threshold);

  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n## Покрытие изменённых строк\n\n${table}\n`,
    );
  }

  if (result.total > 0 && result.pct < threshold) {
    console.error(
      `::error::Diff coverage ${result.pct.toFixed(1)}% ниже порога ${threshold}% — добавь тесты на изменённые строки.`,
    );
    process.exit(1);
  }
} catch (error) {
  console.error(
    `::error::Diff coverage: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
