// Тесты проверок инкубатора: лимиты, обязательные поля, сводка ↔ карточки,
// архив и уникальность ID. Фикстуры — строки, без fs.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LIMITS, parseCard, validateIncubator } from './incubator.mjs';

const row = (id, file, title, status, next = 'потом') =>
  `| [${id}](incubator/${file}) | 2026-09-23 | ${title} | ${status} | ${next} |`;

const indexWith = (rows) =>
  `# Инкубатор\n\n| ID | Дата | Идея | Статус | Что дальше |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`;

const card = (id, title, status, extra = '') =>
  `# ${id} · ${title}\n\n**Дата:** 2026-09-23\n\n**Суть:** тестовая идея.\n**Разбор:** за и против.\n**Связи:** #1.\n**Статус:** ${status}${extra}\n`;

const archiveRow = (id, title, outcome, target) =>
  `| ${id} | 2026-09-23 | ${title} | ${outcome} | ${target} |`;

const archiveWith = (rows) =>
  `# Архив\n\n| ID | Дата | Идея | Итог | Куда / почему |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`;

const run = ({ rows, cards, archive }) =>
  validateIncubator({
    indexText: indexWith(rows),
    cards,
    archiveText: archiveWith(archive),
  });

const fails = (result) => result.results.filter((entry) => entry.status === 'FAIL');

test('корректный инкубатор проходит без блокеров', () => {
  const result = run({
    rows: [row('И-001', 'i-001-ok.md', 'Тестовая идея', 'зреет')],
    cards: [
      {
        filename: 'i-001-ok.md',
        text: card('И-001', 'Тестовая идея', 'зреет — триггер: событие'),
      },
    ],
    archive: [archiveRow('И-002', 'Старая идея', 'в план', '#10')],
  });
  assert.deepEqual(fails(result), []);
  assert.equal(result.nextId, 'И-003');
});

test('«зреет» без триггера — блокер', () => {
  const result = run({
    rows: [row('И-001', 'i-001-ok.md', 'Тестовая идея', 'зреет')],
    cards: [{ filename: 'i-001-ok.md', text: card('И-001', 'Тестовая идея', 'зреет') }],
    archive: [],
  });
  assert.match(
    fails(result)
      .flatMap((entry) => entry.details)
      .join('\n'),
    /триггер/,
  );
});

test('закрытый статус в живой карточке — блокер', () => {
  const result = run({
    rows: [row('И-001', 'i-001-ok.md', 'Тестовая идея', 'в план')],
    cards: [{ filename: 'i-001-ok.md', text: card('И-001', 'Тестовая идея', 'в план') }],
    archive: [],
  });
  assert.match(
    fails(result)
      .flatMap((entry) => entry.details)
      .join('\n'),
    /статус/,
  );
});

test('«обсуждается» без открытых вопросов — блокер', () => {
  const result = run({
    rows: [row('И-001', 'i-001-ok.md', 'Тестовая идея', 'обсуждается')],
    cards: [{ filename: 'i-001-ok.md', text: card('И-001', 'Тестовая идея', 'обсуждается') }],
    archive: [],
  });
  assert.match(
    fails(result)
      .flatMap((entry) => entry.details)
      .join('\n'),
    /Открытые вопросы/,
  );
});

test('«на разбор» без вопроса владельцу — блокер', () => {
  const result = run({
    rows: [row('И-001', 'i-001-ok.md', 'Тестовая идея', 'на разбор')],
    cards: [{ filename: 'i-001-ok.md', text: card('И-001', 'Тестовая идея', 'на разбор') }],
    archive: [],
  });
  assert.match(
    fails(result)
      .flatMap((entry) => entry.details)
      .join('\n'),
    /Вопрос к владельцу/,
  );
});

test('карточка больше жёсткого предела — блокер', () => {
  const result = run({
    rows: [row('И-001', 'i-001-ok.md', 'Тестовая идея', 'зреет')],
    cards: [
      {
        filename: 'i-001-ok.md',
        text:
          card('И-001', 'Тестовая идея', 'зреет — триггер: событие') +
          'x'.repeat(LIMITS.cardCharsFail),
      },
    ],
    archive: [],
  });
  assert.match(
    fails(result)
      .flatMap((entry) => entry.details)
      .join('\n'),
    /жёсткого предела/,
  );
});

test('карточка вне сводной таблицы — блокер', () => {
  const result = run({
    rows: [],
    cards: [
      { filename: 'i-001-ok.md', text: card('И-001', 'Тестовая идея', 'зреет — триггер: событие') },
    ],
    archive: [],
  });
  assert.match(
    fails(result)
      .flatMap((entry) => entry.details)
      .join('\n'),
    /нет в сводной таблице/,
  );
});

test('расхождение статуса таблицы и карточки — блокер', () => {
  const result = run({
    rows: [row('И-001', 'i-001-ok.md', 'Тестовая идея', 'обсуждается')],
    cards: [
      {
        filename: 'i-001-ok.md',
        text: card(
          'И-001',
          'Тестовая идея',
          'зреет — триггер: событие',
          '\n**Открытые вопросы:** что?',
        ),
      },
    ],
    archive: [],
  });
  assert.match(
    fails(result)
      .flatMap((entry) => entry.details)
      .join('\n'),
    /статус в таблице/,
  );
});

test('ID одновременно в живых и архиве — блокер', () => {
  const result = run({
    rows: [row('И-001', 'i-001-ok.md', 'Тестовая идея', 'зреет')],
    cards: [
      { filename: 'i-001-ok.md', text: card('И-001', 'Тестовая идея', 'зреет — триггер: событие') },
    ],
    archive: [archiveRow('И-001', 'Старая идея', 'в план', '#10')],
  });
  assert.match(
    fails(result)
      .flatMap((entry) => entry.details)
      .join('\n'),
    /одновременно/,
  );
});

test('«отклонено» без причины — блокер', () => {
  const result = run({
    rows: [],
    cards: [],
    archive: [archiveRow('И-001', 'Старая идея', 'отклонено', '#10')],
  });
  assert.match(
    fails(result)
      .flatMap((entry) => entry.details)
      .join('\n'),
    /причина/,
  );
});

test('parseCard находит ID, заголовок, дату и размер', () => {
  const parsed = parseCard(
    card('И-007', 'Название', 'обсуждается', '\n**Открытые вопросы:** что?'),
    'i-007-test.md',
  );
  assert.equal(parsed.id, 'И-007');
  assert.equal(parsed.title, 'Название');
  assert.equal(parsed.date, '2026-09-23');
  assert.equal(parsed.status, 'обсуждается');
  assert.equal(parsed.problems.length, 0);
});

test('реальный инкубатор проходит проверку', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const cardsDir = resolve(repoRoot, 'docs/product/incubator');
  const cards = readdirSync(cardsDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({ filename: file, text: readFileSync(resolve(cardsDir, file), 'utf8') }));
  const result = validateIncubator({
    indexText: readFileSync(resolve(repoRoot, 'docs/product/incubator.md'), 'utf8'),
    archiveText: readFileSync(resolve(repoRoot, 'docs/product/incubator-archive.md'), 'utf8'),
    cards,
  });
  assert.deepEqual(
    result.results.filter((entry) => entry.status === 'FAIL'),
    [],
  );
});
