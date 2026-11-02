// Чистые проверки инкубатора: индекс, карточки, архив. Без fs — тесты
// подставляют текст. CLI — scripts/check-incubator.mjs.
//
// Зачем: инкубатор — очередь идей, а не склад истории. Лимиты и обязательные
// поля держат его компактным: одна идея = одна карточка на экран, решённое —
// одна строка в архиве.

export const STATUSES = ['обсуждается', 'на разбор', 'зреет'];
export const ARCHIVE_OUTCOMES = ['в план', 'поглощено', 'разобрано', 'отклонено'];

export const LIMITS = {
  indexCharsWarn: 8000,
  indexCharsFail: 12000,
  cardsWarn: 18,
  cardsFail: 22,
  cardCharsWarn: 2000,
  cardCharsFail: 2600,
  archiveRowsWarn: 300,
};

const ID_RE = /^И-\d{3}$/;
const CARD_FILE_RE = /^i-\d{3}-[a-z0-9-]+\.md$/;
const CARD_LINK_RE = /^incubator\/i-\d{3}-[a-z0-9-]+\.md$/;
const INDEX_ROW_RE =
  /^\|\s*\[(И-\d{3})\]\(([^)]+)\)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/;
const ARCHIVE_ROW_RE =
  /^\|\s*(И-\d{3})\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/;

const clean = (value) => value.replace(/\s+/g, ' ').trim();
const idNumber = (id) => Number(id.slice(2));

/** Строки сводной таблицы индекса: ID, ссылка на карточку, название, статус, «что дальше». */
export function parseIndex(text) {
  const rows = [];
  const problems = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const match = line.match(INDEX_ROW_RE);
    if (!match) continue;
    const [, id, link, date, title, status, next] = match;
    const row = {
      id,
      link: link.trim(),
      date: clean(date),
      title: clean(title),
      status: clean(status),
      next: clean(next),
    };
    if (!ID_RE.test(row.id)) problems.push(`неверный ID: ${row.id}`);
    if (seen.has(row.id)) problems.push(`ID повторяется в таблице: ${row.id}`);
    seen.add(row.id);
    if (!CARD_LINK_RE.test(row.link))
      problems.push(`${row.id}: ссылка должна вести в incubator/i-NNN-slug.md`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date))
      problems.push(`${row.id}: дата не в формате ГГГГ-ММ-ДД`);
    if (!row.title) problems.push(`${row.id}: пустое название идеи`);
    if (!row.next)
      problems.push(`${row.id}: пусто «Что дальше» — одна строка должна объяснять следующий шаг`);
    if (!STATUSES.includes(row.status)) {
      problems.push(`${row.id}: статус «${row.status}» не из набора ${STATUSES.join(' / ')}`);
    }
    rows.push(row);
  }
  return { rows, problems };
}

/** Карточка идеи: заголовок, обязательные поля, статус и его требования. */
export function parseCard(text, filename) {
  const problems = [];
  const heading = text.match(/^#\s+(И-\d{3})\s*·\s*(.+)$/m);
  if (!heading) {
    problems.push(`${filename}: нет заголовка «# И-NNN · Название»`);
  }
  const id = heading?.[1] ?? null;
  const title = heading ? clean(heading[2]) : null;
  if (id && !filename.startsWith(`i-${id.slice(2)}-`)) {
    problems.push(`${filename}: имя файла не совпадает с ID ${id}`);
  }
  if (!CARD_FILE_RE.test(filename)) {
    problems.push(`${filename}: имя файла должно быть i-NNN-slug.md (латиница, дефисы)`);
  }
  for (const field of ['**Суть:**', '**Разбор:**', '**Связи:**', '**Статус:**']) {
    if (!text.includes(field)) problems.push(`${filename}: нет поля ${field}`);
  }
  const date = text.match(/^\*\*Дата:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1] ?? null;
  if (!date) problems.push(`${filename}: нет поля «**Дата:** ГГГГ-ММ-ДД»`);
  const statusLine = text.match(/^\*\*Статус:\*\*\s*(.+)$/m)?.[1]?.trim() ?? '';
  const status = STATUSES.find((value) => statusLine.startsWith(value)) ?? null;
  if (!status) {
    problems.push(
      `${filename}: статус должен начинаться с одного из: ${STATUSES.join(' / ')} (сейчас «${statusLine || 'пусто'}»)`,
    );
  }
  if (status === 'обсуждается' && !text.includes('**Открытые вопросы:**')) {
    problems.push(`${filename}: для «обсуждается» нужны «**Открытые вопросы:**»`);
  }
  if (status === 'на разбор' && !text.includes('**Вопрос к владельцу:**')) {
    problems.push(`${filename}: для «на разбор» нужен «**Вопрос к владельцу:**»`);
  }
  if (status === 'зреет' && !/триггер\s*:/i.test(statusLine)) {
    problems.push(`${filename}: для «зреет» нужен триггер в строке статуса («зреет — триггер: …»)`);
  }
  return { filename, id, title, date, status, chars: text.length, problems };
}

/** Строки архива: ID, дата, идея, итог, куда/почему. */
export function parseArchive(text) {
  const rows = [];
  const problems = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const match = line.match(ARCHIVE_ROW_RE);
    if (!match) continue;
    const [, id, date, title, outcome, target] = match;
    const row = { id, date, title: clean(title), outcome: clean(outcome), target: clean(target) };
    if (seen.has(row.id)) problems.push(`архив: ID повторяется: ${row.id}`);
    seen.add(row.id);
    if (!ARCHIVE_OUTCOMES.includes(row.outcome)) {
      problems.push(
        `${row.id}: итог «${row.outcome}» не из набора ${ARCHIVE_OUTCOMES.join(' / ')}`,
      );
    }
    if (!row.target) {
      problems.push(`${row.id}: пусто «Куда / почему» — у итога должна быть ссылка или причина`);
    }
    if (row.outcome === 'отклонено' && row.target.length < 10) {
      problems.push(`${row.id}: у «отклонено» нужна причина, а не только ссылка`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date))
      problems.push(`${row.id}: дата не в формате ГГГГ-ММ-ДД`);
    rows.push(row);
  }
  return { rows, problems };
}

/**
 * Полная проверка: бюджет индекса, сводка ↔ карточки, карточки, архив, ID.
 * `cards` — [{ filename, text }].
 */
export function validateIncubator({ indexText, cards, archiveText }) {
  const results = [];
  const add = (name, status, details = []) => results.push({ name, status, details });

  const index = parseIndex(indexText);
  const parsedCards = cards.map((card) => parseCard(card.text, card.filename));
  const archive = parseArchive(archiveText);

  // 1. Бюджет индекса и число живых идей.
  const indexChars = indexText.length;
  const indexStatus =
    indexChars > LIMITS.indexCharsFail
      ? 'FAIL'
      : indexChars > LIMITS.indexCharsWarn
        ? 'WARN'
        : 'OK';
  add('Индекс: размер', indexStatus, [
    `${indexChars} знаков (мягкий предел ${LIMITS.indexCharsWarn}, жёсткий ${LIMITS.indexCharsFail})`,
  ]);

  const liveCount = parsedCards.length;
  const liveStatus =
    liveCount > LIMITS.cardsFail ? 'FAIL' : liveCount > LIMITS.cardsWarn ? 'WARN' : 'OK';
  add('Живые идеи: количество', liveStatus, [
    `${liveCount} карточек (мягкий предел ${LIMITS.cardsWarn}, жёсткий ${LIMITS.cardsFail})`,
  ]);

  // 2. Сводка ↔ карточки.
  const cardByFile = new Map(parsedCards.map((card) => [card.filename, card]));
  const referenced = new Set();
  const summaryProblems = [...index.problems];
  for (const row of index.rows) {
    const filename = row.link.split('/').pop();
    const card = cardByFile.get(filename);
    if (!card) {
      summaryProblems.push(`${row.id}: карточка ${row.link} не найдена`);
      continue;
    }
    referenced.add(filename);
    if (card.id !== row.id)
      summaryProblems.push(`${row.id}: в карточке ${filename} стоит ${card.id}`);
    if (card.date !== row.date) {
      summaryProblems.push(`${row.id}: дата в таблице ${row.date}, в карточке ${card.date ?? '—'}`);
    }
    if (card.title !== row.title) {
      summaryProblems.push(
        `${row.id}: название в таблице и карточке расходится («${row.title}» / «${card.title}»)`,
      );
    }
    if (card.status !== row.status) {
      summaryProblems.push(
        `${row.id}: статус в таблице «${row.status}», в карточке «${card.status}»`,
      );
    }
  }
  for (const card of parsedCards) {
    if (!referenced.has(card.filename))
      summaryProblems.push(`${card.filename}: карточки нет в сводной таблице`);
  }
  add('Сводка ↔ карточки', summaryProblems.length ? 'FAIL' : 'OK', summaryProblems);

  // 3. Карточки: поля, статусы, размер.
  const cardProblems = [];
  let maxCard = { chars: 0, id: '—' };
  for (const card of parsedCards) {
    cardProblems.push(...card.problems);
    if (card.chars > LIMITS.cardCharsFail) {
      cardProblems.push(
        `${card.id}: ${card.chars} знаков — больше жёсткого предела ${LIMITS.cardCharsFail}; разбор переноси в issue/ADR`,
      );
    } else if (card.chars > LIMITS.cardCharsWarn) {
      cardProblems.push(
        `${card.id}: ${card.chars} знаков — больше мягкого предела ${LIMITS.cardCharsWarn}; сократи`,
      );
    }
    if (card.chars > maxCard.chars) maxCard = { chars: card.chars, id: card.id ?? '—' };
  }
  add(
    'Карточки: поля и размер',
    cardProblems.length ? 'FAIL' : 'OK',
    cardProblems.length ? cardProblems : [`максимум ${maxCard.chars} знаков (${maxCard.id})`],
  );

  // 4. Архив.
  const archiveStatus = archive.problems.length
    ? 'FAIL'
    : archive.rows.length > LIMITS.archiveRowsWarn
      ? 'WARN'
      : 'OK';
  add('Архив: строки и итоги', archiveStatus, [
    ...archive.problems,
    ...(archive.problems.length
      ? []
      : [`${archive.rows.length} строк (мягкий предел ${LIMITS.archiveRowsWarn})`]),
  ]);

  // 5. ID: уникальны между живыми и архивом.
  const idProblems = [];
  const liveIds = new Set(parsedCards.map((card) => card.id).filter(Boolean));
  const idCounts = new Map();
  for (const card of parsedCards) {
    if (card.id) idCounts.set(card.id, (idCounts.get(card.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) idProblems.push(`${id}: ID встречается у ${count} карточек`);
  }
  for (const row of archive.rows) {
    if (liveIds.has(row.id))
      idProblems.push(`${row.id}: одновременно живая карточка и строка архива`);
  }
  add('ID: уникальность', idProblems.length ? 'FAIL' : 'OK', idProblems);

  // Следующий свободный ID — подсказка для новой идеи.
  const allIds = [...liveIds, ...archive.rows.map((row) => row.id)].filter(Boolean);
  const maxId = allIds.reduce((max, id) => Math.max(max, idNumber(id)), 0);
  const nextId = `И-${String(maxId + 1).padStart(3, '0')}`;

  return {
    results,
    nextId,
    stats: { liveCount, archivedCount: archive.rows.length, indexChars, maxCard },
  };
}
