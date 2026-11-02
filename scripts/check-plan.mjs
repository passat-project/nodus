#!/usr/bin/env node
// Механическая проверка техплана feature-architect (Ф6): разделы/«не применимо»,
// источники у решений, существование file:line ссылок, доказательства у критериев
// приёмки, длина комментария GitHub. Вывод прикладывается к плану; «конвейер
// пройден» без зелёного вывода этого скрипта не пишется.
//
//   pnpm plan:check docs/mvp/plans/<N>-<slug>-plan.md
//
// Ссылки на файлы, которых ещё нет (план их создаёт), помечаются в плане словом
// «(новый)» рядом со ссылкой — скрипт их не считает ошибкой.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = resolve(dirnameOf(import.meta.url), '..');
const planPath = process.argv[2];
if (!planPath || planPath.startsWith('--')) {
  console.error('Использование: pnpm plan:check <файл плана.md>');
  process.exit(2);
}
const planAbs = resolve(repoRoot, planPath);
if (!existsSync(planAbs)) {
  console.error(`План не найден: ${planPath}`);
  process.exit(2);
}
const plan = readFileSync(planAbs, 'utf8');
const results = [];
const add = (name, status, details) => results.push({ name, status, details });

// 1. Разделы шаблона: заголовок есть ИЛИ строка «не применимо» с номером раздела.
const REQUIRED_SECTIONS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '4a',
  '4b',
  '4c',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
];
const missing = [];
for (const id of REQUIRED_SECTIONS) {
  const hasHeading = new RegExp(`^##\\s*${id}\\.`, 'm').test(plan);
  const markedNA = new RegExp(`§?\\s*${id}\\b[^\\n]{0,80}не применимо`, 'i').test(plan);
  if (!hasHeading && !markedNA) missing.push(`§${id}`);
}
add(
  'Разделы шаблона (или «не применимо: причина»)',
  missing.length ? 'FAIL' : 'OK',
  missing.length ? [`Нет разделов и нет строк «не применимо»: ${missing.join(', ')}`] : [],
);

// 2. У каждого решения РN — источник.
const decisions = plan.match(/^\s*-\s+\*\*Р\d+\./gm) ?? [];
const sources = plan.match(/Источник:/g) ?? [];
add(
  'Источники решений',
  decisions.length === 0 || sources.length < decisions.length ? 'FAIL' : 'OK',
  decisions.length === 0
    ? ['В §4 нет решений РN — план без решений не публикуется']
    : sources.length >= decisions.length
      ? [`${decisions.length} решений, ${sources.length} источников`]
      : [
          `Решений ${decisions.length}, строк «Источник:» ${sources.length} — у каждого РN нужен источник`,
        ],
);

// 3. file:line ссылки: файл существует (точный путь или уникальный basename), строка в пределах файла.
const gitFiles = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
const lineCountCache = new Map();
const lineCount = (abs) => {
  if (!lineCountCache.has(abs)) {
    lineCountCache.set(abs, readFileSync(abs, 'utf8').split('\n').length);
  }
  return lineCountCache.get(abs);
};
const refRe = /([\w./\\-]+\.(?:ts|tsx|js|mjs|cjs|css|json|md|sql|prisma|yml|yaml|html|vue)):(\d+)/g;
const refProblems = [];
const refNew = [];
const refChecked = new Set();
for (const line of plan.split('\n')) {
  if (/\(новый\)|новый файл/i.test(line)) {
    for (const m of line.matchAll(refRe)) refNew.push(m[0]);
    continue;
  }
  for (const m of line.matchAll(refRe)) {
    const raw = m[1].replace(/\\/g, '/');
    const ln = Number(m[2]);
    const key = `${raw}:${ln}`;
    if (refChecked.has(key)) continue;
    refChecked.add(key);
    let abs = resolve(repoRoot, raw);
    if (!existsSync(abs)) {
      const hits = gitFiles.filter((f) => basename(f) === basename(raw));
      if (hits.length === 1) abs = resolve(repoRoot, hits[0]);
      else if (hits.length === 0) {
        refProblems.push(
          `файл не найден: ${m[0]} (если план создаёт файл — пометь «(новый)» рядом)`,
        );
        continue;
      } else {
        refProblems.push(`неоднозначное имя (${hits.length} файла): ${m[0]}`);
        continue;
      }
    }
    if (ln > lineCount(abs)) refProblems.push(`строка за концом файла: ${m[0]}`);
  }
}
add(
  'file:line ссылки существуют',
  refProblems.length ? 'FAIL' : refChecked.size === 0 ? 'WARN' : 'OK',
  refProblems.length
    ? [
        ...refProblems.slice(0, 15),
        ...(refProblems.length > 15 ? [`… всего ${refProblems.length}`] : []),
      ]
    : refChecked.size === 0
      ? ['0 file:line ссылок — план «проверено по коду» без адресов подозрителен']
      : [
          `проверено ${refChecked.size}${refNew.length ? `, помечено «(новый)»: ${refNew.length}` : ''}`,
        ],
);

// 4. Критерии приёмки: у каждого критерия — доказательство с командой/тестом/гейтом.
const sec9 = plan.match(/^##\s*9\.[^\n]*\n([\s\S]*?)(?=^##\s|\n##\s)/m)?.[1] ?? '';
const proofWords = /(тест|e2e|гейт|вердикт|проба|pnpm|integration|unit|`[^`]+`)/i;
const noProof = sec9
  .split('\n')
  .filter((l) => l.trimStart().startsWith('|'))
  .filter((l) => !/^\s*\|[\s-|:]+\|\s*$/.test(l))
  .filter((l) => !/Критерий|Доказывается/i.test(l))
  .filter((l) => !proofWords.test(l));
add(
  'Критерии приёмки → доказательства',
  sec9.trim() === '' ? 'FAIL' : noProof.length ? 'FAIL' : 'OK',
  sec9.trim() === ''
    ? ['Раздел §9 пуст — критерии приёмки обязательны']
    : noProof.length
      ? noProof.map((l) => `без доказательства-команды: ${l.slice(0, 90)}…`)
      : [],
);

// 5. Длина: лимит комментария GitHub 65 536 знаков.
const len = plan.length;
add('Длина плана', len > 65536 ? 'FAIL' : len > 60000 ? 'WARN' : 'OK', [
  `${len} знаков (лимит комментария GitHub 65 536${len > 60000 ? ' — близко' : ''})`,
]);

// Вывод.
const icon = { OK: '✓', WARN: '⚠', FAIL: '✗' };
console.log(`\nplan:check — ${planPath}`);
for (const r of results) {
  console.log(`${icon[r.status]} ${r.name}`);
  for (const d of r.details) console.log(`    ${d}`);
}
const fails = results.filter((r) => r.status === 'FAIL').length;
const warns = results.filter((r) => r.status === 'WARN').length;
console.log(
  `\nИтог: ${fails ? `${fails} блокирующих` : 'без блокеров'}${warns ? `, ${warns} предупреждений` : ''} — ${fails ? 'НЕ ПРОЙДЕН' : 'ПРОЙДЕН'}\n`,
);
process.exit(fails ? 1 : 0);

function dirnameOf(url) {
  return fileURLToPath(new URL('.', url));
}
