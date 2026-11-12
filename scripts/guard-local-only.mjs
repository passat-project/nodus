#!/usr/bin/env node
/**
 * Страховка локальных интервью (#807): папка `docs/product/interviews/` живёт
 * только на ПК владельца и закрыта `.gitignore`, поэтому обычный `git add` её
 * не берёт. Обойти правило можно только руками (`git add -f`) — хук это и
 * ловит: коммит с любым файлом папки (кроме README-указателя) отменяется.
 * Механизм: список файлов индекса `git diff --cached --name-only`.
 */
import { execFileSync } from 'node:child_process';

const PREFIX = 'docs/product/interviews/';
const ALLOWED = new Set([`${PREFIX}README.md`]);

let staged = '';
try {
  staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  });
} catch (error) {
  console.error('guard-local-only: не удалось прочитать индекс git:', error.message);
  process.exit(1);
}

const offenders = staged
  .split(/\r?\n/)
  .map((file) => file.trim())
  .filter((file) => file.startsWith(PREFIX) && !ALLOWED.has(file));

if (offenders.length > 0) {
  console.error('Коммит остановлен: интервью не публикуются в репозиторий (#807).');
  for (const file of offenders) console.error(`  ${file}`);
  console.error('Уберите файлы из индекса: git restore --staged <файл>');
  process.exit(1);
}
