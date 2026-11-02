#!/usr/bin/env node
// Проверка инкубатора: индекс + карточки + архив. Запуск:
//   pnpm incubator:check
// Блокеры — код 1; предупреждения — код 0. Подсказывает следующий свободный ID.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateIncubator } from './lib/incubator.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = resolve(repoRoot, 'docs/product/incubator.md');
const archivePath = resolve(repoRoot, 'docs/product/incubator-archive.md');
const cardsDir = resolve(repoRoot, 'docs/product/incubator');

const stop = (message) => {
  console.error(message);
  process.exit(2);
};

for (const [path, what] of [
  [indexPath, 'индекс'],
  [archivePath, 'архив'],
  [cardsDir, 'папка карточек'],
]) {
  if (!existsSync(path)) stop(`Не найден ${what}: ${path}`);
}

const indexText = readFileSync(indexPath, 'utf8');
const archiveText = readFileSync(archivePath, 'utf8');
const cards = readdirSync(cardsDir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => ({ filename: file, text: readFileSync(resolve(cardsDir, file), 'utf8') }));

const { results, nextId, stats } = validateIncubator({ indexText, cards, archiveText });
const icon = { OK: '✓', WARN: '⚠', FAIL: '✗' };

console.log('\nincubator:check — docs/product/incubator.md');
for (const result of results) {
  console.log(`${icon[result.status]} ${result.name}`);
  for (const detail of result.details) console.log(`    ${detail}`);
}

console.log(
  `\nЖивых идей: ${stats.liveCount}, в архиве: ${stats.archivedCount}, индекс: ${stats.indexChars} знаков.`,
);
console.log(`Следующий свободный ID: ${nextId}\n`);

const fails = results.filter((result) => result.status === 'FAIL').length;
const warns = results.filter((result) => result.status === 'WARN').length;
console.log(
  `Итог: ${fails ? `${fails} блокирующих` : 'без блокеров'}${warns ? `, ${warns} предупреждений` : ''} — ${fails ? 'НЕ ПРОЙДЕН' : 'ПРОЙДЕН'}\n`,
);
process.exit(fails ? 1 : 0);
