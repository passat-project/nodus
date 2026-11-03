import fs from 'node:fs';
import path from 'node:path';

const GROUPS = ['apps', 'packages'];

/**
 * Собирает per-package `coverage/coverage-summary.json`, которые пишет
 * `vitest run --coverage` (reporter json-summary). Пакеты без отчёта
 * пропускаются: на affected-only прогоне их просто не запускали.
 */
export function collectCoverage(root = process.cwd()) {
  const rows = [];
  for (const group of GROUPS) {
    const groupDir = path.join(root, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const name of fs.readdirSync(groupDir)) {
      const file = path.join(groupDir, name, 'coverage', 'coverage-summary.json');
      if (!fs.existsSync(file)) continue;
      const { total } = JSON.parse(fs.readFileSync(file, 'utf8'));
      rows.push({ package: `${group}/${name}`, total });
    }
  }
  return rows.sort((a, b) => a.package.localeCompare(b.package));
}

const pct = (metric) => `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`;

export function formatCoverageTable(rows) {
  if (rows.length === 0) {
    return 'Покрытие: отчёты `coverage-summary.json` не найдены.';
  }
  const header = '| Пакет | Строки | Операторы | Ветви | Функции |';
  const separator = '| --- | ---: | ---: | ---: | ---: |';
  const body = rows.map(
    ({ package: pkg, total }) =>
      `| ${pkg} | ${pct(total.lines)} | ${pct(total.statements)} | ${pct(total.branches)} | ${pct(total.functions)} |`,
  );
  return [header, separator, ...body].join('\n');
}
