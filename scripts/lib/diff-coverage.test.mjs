import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  collectCoverage,
  computeDiffCoverage,
  formatDiffCoverage,
  isCoverageSource,
  normalizeCoveragePath,
  parseChangedLines,
  parseLcov,
} from './diff-coverage.mjs';

const DIFF = `diff --git a/apps/api/src/a.ts b/apps/api/src/a.ts
index 111..222 100644
--- a/apps/api/src/a.ts
+++ b/apps/api/src/a.ts
@@ -10,0 +11,2 @@
+one
+two
@@ -20 +22 @@
-old
+new
diff --git a/apps/web/src/b.tsx b/apps/web/src/b.tsx
--- a/apps/web/src/b.tsx
+++ b/apps/web/src/b.tsx
@@ -1,0 +1,1 @@
+first
`;

const LCOV = `SF:src/a.ts
DA:11,1
DA:12,0
end_of_record
SF:src/a.ts
DA:12,2
DA:13,0
end_of_record
`;

describe('diff-coverage (#596)', () => {
  it('парсит добавленные строки из git diff и игнорирует удалённые', () => {
    const changed = parseChangedLines(DIFF);

    assert.deepEqual(
      [...changed.get('apps/api/src/a.ts')].sort((a, b) => a - b),
      [11, 12, 22],
    );
    assert.deepEqual([...changed.get('apps/web/src/b.tsx')], [1]);
  });

  it('не считает файлом содержимое строки, начинающееся с плюса', () => {
    const diff = `diff --git a/apps/api/src/a.ts b/apps/api/src/a.ts
--- a/apps/api/src/a.ts
+++ b/apps/api/src/a.ts
@@ -1,0 +1,1 @@
++++ b/not-a-header
`;

    assert.deepEqual([...parseChangedLines(diff).get('apps/api/src/a.ts')], [1]);
  });

  it('суммирует DA-записи одного файла из нескольких секций lcov', () => {
    const files = parseLcov(LCOV);
    const lines = files.get('src/a.ts');

    assert.equal(lines.get(11), 1);
    assert.equal(lines.get(12), 2);
    assert.equal(lines.get(13), 0);
  });

  it('нормализует относительные, Windows- и POSIX-пути lcov', () => {
    assert.equal(normalizeCoveragePath('src/a.ts', 'apps/api'), 'apps/api/src/a.ts');
    assert.equal(
      normalizeCoveragePath('D:\\Project\\AI\\nodus\\apps\\api\\src\\a.ts', 'apps/api'),
      'apps/api/src/a.ts',
    );
    assert.equal(
      normalizeCoveragePath('/home/runner/work/nodus/nodus/apps/api/src/a.ts', 'apps/api'),
      'apps/api/src/a.ts',
    );
    assert.equal(normalizeCoveragePath('/other/src/a.ts', 'apps/api'), null);
  });

  it('считает только исполняемые изменённые строки', () => {
    const result = computeDiffCoverage({
      changedLines: new Map([['apps/api/src/a.ts', new Set([11, 12, 13])]]),
      coverage: new Map([
        [
          'apps/api/src/a.ts',
          new Map([
            [11, 1],
            [12, 0],
          ]),
        ],
      ]),
      packages: ['apps/api'],
    });

    assert.equal(result.total, 2);
    assert.equal(result.covered, 1);
    assert.deepEqual(result.rows[0].uncovered, [12]);
  });

  it('новый source-файл без lcov-записи считается непокрытым целиком', () => {
    const result = computeDiffCoverage({
      changedLines: new Map([['apps/api/src/new.ts', new Set([1, 2, 3])]]),
      coverage: new Map(),
      packages: ['apps/api'],
    });

    assert.equal(result.total, 3);
    assert.equal(result.covered, 0);
    assert.equal(result.pct, 0);
  });

  it('исключает тесты, моки, generated, пакетные test/, entrypoint и packages/ui', () => {
    assert.equal(isCoverageSource('apps/api/src/a.ts'), true);
    assert.equal(isCoverageSource('apps/api/src/modules/projects/projects.service.ts'), true);
    assert.equal(isCoverageSource('apps/api/src/a.test.ts'), false);
    assert.equal(isCoverageSource('apps/api/src/mocks/handlers.ts'), false);
    assert.equal(isCoverageSource('apps/api/src/generated/prisma/client.ts'), false);
    assert.equal(isCoverageSource('apps/api/test/integration/test-db.ts'), false);
    assert.equal(isCoverageSource('apps/api/test/integration/chat-fixtures.ts'), false);
    assert.equal(isCoverageSource('apps/gateway/test/integration/test-db.ts'), false);
    assert.equal(isCoverageSource('apps/web/src/app/mocks-handlers.ts'), false);
    assert.equal(isCoverageSource('apps/web/src/app/msw-browser.ts'), false);
    assert.equal(isCoverageSource('apps/web/src/main.tsx'), false);
    assert.equal(isCoverageSource('apps/api/src/main.ts'), false);
    assert.equal(isCoverageSource('apps/api/src/scripts/backfill-thumbnails.ts'), false);
    assert.equal(isCoverageSource('packages/ui/src/components/button.tsx'), false);
    assert.equal(isCoverageSource('apps/api/prisma/seed.ts'), false);
  });

  it('падает, если для затронутого пакета нет lcov — гейт не должен молчать', () => {
    assert.throws(
      () =>
        computeDiffCoverage({
          changedLines: new Map([['apps/web/src/page.tsx', new Set([1])]]),
          coverage: new Map(),
          packages: ['apps/api'],
        }),
      /нет coverage\/lcov\.info для apps\/web/,
    );
  });

  it('без исполняемых изменённых строк гейт пропускается', () => {
    const result = computeDiffCoverage({
      changedLines: new Map([['apps/api/src/a.ts', new Set([99])]]),
      coverage: new Map([['apps/api/src/a.ts', new Map([[1, 1]])]]),
      packages: ['apps/api'],
    });

    assert.equal(result.total, 0);
    assert.match(formatDiffCoverage(result, 80), /гейт пропущен/);
  });

  it('форматирует таблицу с процентами и непокрытыми строками', () => {
    const table = formatDiffCoverage(
      {
        total: 2,
        covered: 1,
        pct: 50,
        rows: [{ file: 'apps/api/src/a.ts', total: 2, covered: 1, uncovered: [12] }],
      },
      80,
    );

    assert.match(table, /\| apps\/api\/src\/a\.ts \| 1 \| 2 \| 50% \| 12 \|/);
    assert.match(table, /Итого: 1\/2 строк \(50\.0%\), порог 80%/);
  });

  it('collectCoverage читает lcov пакетов и переписывает пути в repo-relative', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-diff-coverage-'));
    try {
      const apiDir = path.join(root, 'apps', 'api', 'coverage');
      const apiIntegrationDir = path.join(root, 'apps', 'api', 'coverage-integration');
      const contractsDir = path.join(root, 'packages', 'contracts', 'coverage');
      fs.mkdirSync(apiDir, { recursive: true });
      fs.mkdirSync(apiIntegrationDir, { recursive: true });
      fs.mkdirSync(contractsDir, { recursive: true });
      fs.writeFileSync(path.join(apiDir, 'lcov.info'), 'SF:src/a.ts\nDA:11,1\nend_of_record\n');
      fs.writeFileSync(
        path.join(apiIntegrationDir, 'lcov.info'),
        'SF:src/a.ts\nDA:12,1\nend_of_record\n',
      );
      fs.writeFileSync(
        path.join(contractsDir, 'lcov.info'),
        'SF:src/x.ts\nDA:1,0\nend_of_record\n',
      );

      const { coverage, packages } = collectCoverage(root);

      assert.deepEqual(packages.sort(), ['apps/api', 'packages/contracts']);
      assert.equal(coverage.get('apps/api/src/a.ts').get(11), 1);
      assert.equal(coverage.get('apps/api/src/a.ts').get(12), 1);
      assert.equal(coverage.get('packages/contracts/src/x.ts').get(1), 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
