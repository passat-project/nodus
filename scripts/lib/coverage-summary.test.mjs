import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { collectCoverage, formatCoverageTable } from './coverage-summary.mjs';

const tmpDirs = [];

function makeSummary(lines, statements, branches, functions) {
  const metric = (pct) => ({ total: 100, covered: pct, skipped: 0, pct });
  return {
    total: {
      lines: metric(lines),
      statements: metric(statements),
      branches: metric(branches),
      functions: metric(functions),
    },
  };
}

function writeSummary(root, group, name, summary) {
  const dir = path.join(root, group, name, 'coverage');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'coverage-summary.json'), JSON.stringify(summary));
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-coverage-'));
  tmpDirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('coverage-summary (#593)', () => {
  it('собирает отчёты apps и packages, сортирует по имени пакета', () => {
    const root = makeRoot();
    writeSummary(root, 'packages', 'contracts', makeSummary(73.89, 74.85, 82.76, 80.09));
    writeSummary(root, 'apps', 'api', makeSummary(56.75, 55.01, 50.84, 41.48));

    const rows = collectCoverage(root);

    assert.deepEqual(
      rows.map((row) => row.package),
      ['apps/api', 'packages/contracts'],
    );
    assert.equal(rows[0].total.lines.pct, 56.75);
  });

  it('пропускает пакеты без coverage-summary.json', () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });

    assert.deepEqual(collectCoverage(root), []);
  });

  it('рисует markdown-таблицу с процентами и абсолютными числами', () => {
    const table = formatCoverageTable([
      { package: 'apps/api', total: makeSummary(56.75, 55.01, 50.84, 41.48).total },
    ]);

    assert.match(table, /\| apps\/api \| 56\.75% \(56\.75\/100\) \|/);
    assert.match(table, /\| Пакет \| Строки \| Операторы \| Ветви \| Функции \|/);
  });

  it('без отчётов возвращает понятное сообщение, а не пустую таблицу', () => {
    assert.equal(formatCoverageTable([]), 'Покрытие: отчёты `coverage-summary.json` не найдены.');
  });
});
