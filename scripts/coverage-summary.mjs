#!/usr/bin/env node
import fs from 'node:fs';

import { collectCoverage, formatCoverageTable } from './lib/coverage-summary.mjs';

// Сводка не гейт: покрытие уже проверено порогами в vitest-конфигах.
// Ошибка чтения отчёта не должна ронять CI после зелёных тестов.
let table;
try {
  table = formatCoverageTable(collectCoverage());
} catch (error) {
  table = `Покрытие: не удалось собрать сводку — ${error instanceof Error ? error.message : String(error)}`;
}

console.log(table);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## Покрытие unit-тестов\n\n${table}\n`);
}
