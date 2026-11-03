import fs from 'node:fs';
import path from 'node:path';

const SOURCE_FILE = /\.(ts|tsx)$/;

const EXCLUDED = [
  /(^|\/)node_modules\//,
  /\.(test|spec)\.(ts|tsx)$/,
  /\.d\.ts$/,
  /(^|\/)generated\//,
  /(^|\/)mocks\//,
  /(^|\/)fixtures\//,
  /^packages\/ui\//,
  /^apps\/desktop\//,
  /^tests\//,
  /^scripts\//,
  /^docs\//,
  /^\.github\//,
  /(^|\/)prisma\//,
  /\.config\.(ts|tsx|mjs|cjs)$/,
];

/** Добавленные/изменённые строки нового файла из `git diff --unified=0`. */
export function parseChangedLines(diffText) {
  const changed = new Map();
  let currentFile = null;
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of diffText.split('\n')) {
    if (rawLine.startsWith('diff --git ')) {
      currentFile = null;
      inHunk = false;
      continue;
    }
    if (!inHunk && (rawLine.startsWith('+++ b/') || rawLine.startsWith('+++ /dev/null'))) {
      const file = rawLine.slice(4).trim();
      currentFile = file === '/dev/null' ? null : file.replace(/^b\//, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(rawLine);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || !currentFile) continue;
    if (rawLine.startsWith('+')) {
      if (!changed.has(currentFile)) changed.set(currentFile, new Set());
      changed.get(currentFile).add(newLine);
      newLine++;
    } else if (rawLine.startsWith(' ')) {
      newLine++;
    }
    // '-' (удалённая строка) и '\' (нет newline) номер новой строки не двигают.
  }

  return changed;
}

/** `SF:`-пути lcov → repo-relative (`apps/api/src/...`). */
export function normalizeCoveragePath(sf, packageRoot) {
  const normalized = sf.replace(/\\/g, '/').replace(/^\.\//, '');
  const marker = `/${packageRoot}/`;
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) return normalized.slice(markerIndex + 1);
  if (normalized.startsWith(`${packageRoot}/`)) return normalized;
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
  return absolute ? null : `${packageRoot}/${normalized}`;
}

/** `DA:<line>,<hits>[,<checksum>]` из lcov; несколько записей одного файла суммируются. */
export function parseLcov(lcovText) {
  const files = new Map();
  let current = null;

  for (const line of lcovText.split('\n')) {
    if (line.startsWith('SF:')) {
      current = line.slice(3).trim();
      if (!files.has(current)) files.set(current, new Map());
      continue;
    }
    if (line.startsWith('DA:') && current) {
      const [lineNo, hits] = line.slice(3).split(',');
      const number = Number(lineNo);
      const fileLines = files.get(current);
      fileLines.set(number, (fileLines.get(number) ?? 0) + Number(hits));
      continue;
    }
    if (line === 'end_of_record') current = null;
  }

  return files;
}

/** Все lcov-отчёты пакетов: unit (`coverage`) и integration (`coverage-integration`). */
export function collectCoverage(root = process.cwd()) {
  const coverage = new Map();
  const packages = [];

  for (const group of ['apps', 'packages']) {
    const groupDir = path.join(root, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const name of fs.readdirSync(groupDir)) {
      const packageRoot = `${group}/${name}`;
      let found = false;
      for (const reportDir of ['coverage', 'coverage-integration']) {
        const lcovPath = path.join(groupDir, name, reportDir, 'lcov.info');
        if (!fs.existsSync(lcovPath)) continue;
        found = true;
        for (const [sf, lines] of parseLcov(fs.readFileSync(lcovPath, 'utf8'))) {
          const file = normalizeCoveragePath(sf, packageRoot);
          if (!file) continue;
          const existing = coverage.get(file) ?? new Map();
          for (const [lineNo, hits] of lines)
            existing.set(lineNo, (existing.get(lineNo) ?? 0) + hits);
          coverage.set(file, existing);
        }
      }
      if (found) packages.push(packageRoot);
    }
  }

  return { coverage, packages };
}

export function isCoverageSource(file) {
  return SOURCE_FILE.test(file) && !EXCLUDED.some((pattern) => pattern.test(file));
}

function packageOf(file) {
  return /^(apps|packages)\/[^/]+/.exec(file)?.[0] ?? null;
}

/**
 * Покрытие только изменённых исполняемых строк. Новый source-файл без записи
 * в lcov считается непокрытым целиком — это и есть гейт против «кода без тестов».
 */
export function computeDiffCoverage({ changedLines, coverage, packages }) {
  const rows = [];
  let total = 0;
  let covered = 0;
  const packagesWithCoverage = new Set(packages);

  for (const [file, lines] of changedLines) {
    if (!isCoverageSource(file)) continue;
    const packageRoot = packageOf(file);
    if (!packageRoot) continue;
    if (!packagesWithCoverage.has(packageRoot)) {
      throw new Error(
        `нет coverage/lcov.info для ${packageRoot}: прогони test:coverage для затронутых пакетов`,
      );
    }

    const fileCoverage = coverage.get(file);
    const executable = fileCoverage
      ? [...lines].filter((line) => fileCoverage.has(line))
      : [...lines];
    if (executable.length === 0) continue;

    const coveredLines = executable.filter((line) => (fileCoverage?.get(line) ?? 0) > 0);
    rows.push({
      file,
      total: executable.length,
      covered: coveredLines.length,
      uncovered: executable.filter((line) => !coveredLines.includes(line)).sort((a, b) => a - b),
    });
    total += executable.length;
    covered += coveredLines.length;
  }

  rows.sort((a, b) => a.file.localeCompare(b.file));
  return { total, covered, pct: total === 0 ? 100 : (covered / total) * 100, rows };
}

export function formatDiffCoverage(result, threshold) {
  if (result.total === 0) return 'Diff coverage: нет изменённых исполняемых строк — гейт пропущен.';

  const header = '| Файл | Покрыто | Всего | % | Непокрытые строки |';
  const separator = '| --- | ---: | ---: | ---: | --- |';
  const body = result.rows.map((row) => {
    const pct = ((row.covered / row.total) * 100).toFixed(0);
    const uncovered =
      row.uncovered.slice(0, 20).join(', ') + (row.uncovered.length > 20 ? '…' : '');
    return `| ${row.file} | ${row.covered} | ${row.total} | ${pct}% | ${uncovered || '—'} |`;
  });
  const summary = `Итого: ${result.covered}/${result.total} строк (${result.pct.toFixed(1)}%), порог ${threshold}%.`;
  return [header, separator, ...body, '', summary].join('\n');
}
