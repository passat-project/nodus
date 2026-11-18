import type {
  SearchFacets,
  SearchHit,
  SearchMatch,
  SearchReason,
  SearchRequest,
  SearchResponse,
  SearchSourceType,
} from '@nodus/contracts';
import { SEARCH_LIMITS, SEARCH_SNIPPET_END, SEARCH_SNIPPET_START } from '@nodus/contracts';

import type { MockActor } from '../../../../shared/mocks/mock-actor.js';
import {
  conversationLabel,
  HALF_LIFE_DAYS,
  mockSearchDocuments,
  type MockDocument,
} from './search-mock-corpus.js';

/**
 * Ранжирование мок-поиска (#952, P1): те же правила ответа, что у сервера,
 * — `score` 0..1, причины, «похоже на» для опечаток (цифры ±1), бусты
 * типа/свежести/участия, фильтры `types`/`projectId`/периода, сортировки,
 * курсор окна топ-100, фасеты без выбранного типа, `hint='stopwords'`.
 *
 * Это НЕ эталон серверного ранжирования (P2 — FTS + trigram + exact):
 * мок воспроизводит форму и правила, чтобы UI не переучивать после бэкенда.
 */
const TYPE_WEIGHT: Record<SearchSourceType, number> = {
  project: 1.1,
  employee: 1.1,
  task: 1.05,
  letter: 1.05,
  message: 0.95,
};
const STOPWORDS = new Set(
  'и в во на с со по о об для не что как это а но или из у к же ли бы за от до'.split(' '),
);

export function normalizeSearchText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const tokensOf = (raw: string): string[] => normalizeSearchText(raw).split(' ').filter(Boolean);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 1; i <= b.length; i += 1) {
    let prev = rows[0]!;
    rows[0] = i;
    for (let j = 1; j <= a.length; j += 1) {
      const current = rows[j]!;
      rows[j] = Math.min(rows[j]! + 1, rows[j - 1]! + 1, prev + (a[j - 1] === b[i - 1] ? 0 : 1));
      prev = current;
    }
  }
  return rows[a.length]!;
}

/** «Похоже на» для опечатки в цифрах: те же разряды, отличается ровно один. */
export function digitSimilar(a: string, b: string): boolean {
  const digitsA = a.replace(/\D/g, '');
  const digitsB = b.replace(/\D/g, '');
  if (digitsA.length < 3 || digitsA.length !== digitsB.length) return false;
  let diff = 0;
  for (let i = 0; i < digitsA.length; i += 1) {
    if (digitsA[i] !== digitsB[i]) diff += 1;
  }
  return diff === 1;
}

function wordSimilar(a: string, b: string): boolean {
  // Ровно одна замена — опечатка. Идентичное слово сюда не попадает:
  // иначе частичный запрос ложно давал бы «похоже» по совпавшему слову.
  return (
    a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 1 && levenshtein(a, b) === 1
  );
}

/** Окно вокруг первого вхождения слова запроса + маркеры подсветки (те же
 *  `\u0001`/`\u0002`, что отдаёт сервер). */
export function mockSnippet(title: string, body: string, q: string): string {
  const source = body.trim() !== '' ? body : title;
  if (source === '') return '';
  const lowered = source.toLowerCase();
  const tokens = tokensOf(q).filter((token) => token.length >= 2);
  let index = -1;
  let token = '';
  for (const candidate of tokens) {
    const found = lowered.indexOf(candidate);
    if (found >= 0 && (index < 0 || found < index)) {
      index = found;
      token = candidate;
    }
  }
  if (index < 0) {
    return source.length > 160 ? `${source.slice(0, 160)}…` : source;
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(source.length, index + token.length + 100);
  const before = source.slice(start, index);
  const marked = source.slice(index, index + token.length);
  const after = source.slice(index + token.length, end);
  return `${start > 0 ? '…' : ''}${before}${SEARCH_SNIPPET_START}${marked}${SEARCH_SNIPPET_END}${after}${end < source.length ? '…' : ''}`;
}

interface Scored {
  doc: MockDocument;
  base: number;
  match: SearchMatch;
  reasons: SearchReason[];
}

function scoreDocument(doc: MockDocument, q: string, tokens: string[]): Scored | null {
  const title = normalizeSearchText(doc.title);
  const body = normalizeSearchText(doc.body);
  const keywords = normalizeSearchText(doc.keywords);
  const haystack = `${title} ${body} ${keywords}`;
  const identifiers = doc.identifiers.map(normalizeSearchText).filter(Boolean);
  const reasons = new Set<SearchReason>();
  let base = 0;
  let match: SearchMatch = 'similar';

  if (
    identifiers.some(
      (identifier) => identifier === q || (q.length >= 3 && identifier.startsWith(q)),
    )
  ) {
    base = 1;
    match = 'exact';
    reasons.add('number');
  }
  if (title.includes(q)) {
    base = Math.max(base, 0.9);
    match = 'exact';
    reasons.add('title');
  }
  if (doc.counterpartyName && normalizeSearchText(doc.counterpartyName).includes(q)) {
    base = Math.max(base, 0.8);
    reasons.add('counterparty');
  }
  if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) {
    base = Math.max(base, 0.6);
    reasons.add(body.includes(q) ? 'body' : 'title');
  }
  if (base === 0 && identifiers.some((identifier) => digitSimilar(identifier, q))) {
    base = 0.55;
    reasons.add('number');
  }
  if (base === 0) {
    const titleWords = title.split(' ').filter((word) => word.length >= 4);
    if (tokens.some((token) => titleWords.some((word) => wordSimilar(word, token)))) {
      base = 0.4;
      reasons.add('title');
    }
  }
  if (base === 0) return null;

  const ageDays = Math.max(0, (Date.now() - Date.parse(doc.sourceCreatedAt)) / 86_400_000);
  const halfLife = HALF_LIFE_DAYS[doc.type];
  if (halfLife !== null && ageDays < halfLife / 2) reasons.add('recent');
  return { doc, base, match, reasons: [...reasons] };
}

function participantBoost(scored: Scored, actor: MockActor): number {
  const { doc } = scored;
  if (doc.type !== 'task' && doc.type !== 'letter') return 1;
  if (!doc.participantIds.includes(actor.id)) return 1;
  if (!scored.reasons.includes('participant')) scored.reasons.push('participant');
  return 1.1;
}

function hitOf(scored: Scored, actor: MockActor, q: string): SearchHit {
  const { doc } = scored;
  const raw = scored.base * TYPE_WEIGHT[doc.type] * participantBoost(scored, actor);
  const ageDays = Math.max(0, (Date.now() - Date.parse(doc.sourceCreatedAt)) / 86_400_000);
  const halfLife = HALF_LIFE_DAYS[doc.type];
  const recency = halfLife === null ? 1 : 0.7 + 0.3 * Math.exp(-ageDays / halfLife);
  const score = Math.min(1, Math.round(raw * recency * 10_000) / 10_000);
  const base = {
    id: doc.id,
    title: doc.title,
    snippet: mockSnippet(doc.title, doc.body, q),
    score,
    match: scored.match,
    reasons: scored.reasons,
    sourceCreatedAt: doc.sourceCreatedAt,
  };
  switch (doc.type) {
    case 'task':
      return {
        ...base,
        type: 'task',
        meta: {
          number: doc.taskNumber ?? null,
          projectId: doc.projectId,
          projectName: doc.projectName,
          deadline: null,
        },
      };
    case 'letter':
      return {
        ...base,
        type: 'letter',
        meta: {
          regNumber: doc.regNumber ?? null,
          counterpartyId: doc.counterpartyId,
          counterpartyName: doc.counterpartyName,
          direction: doc.direction ?? 'incoming',
        },
      };
    case 'message': {
      const conversation = doc.conversation!;
      return {
        ...base,
        type: 'message',
        meta: {
          conversationId: conversation.id,
          conversationType: conversation.type,
          conversationLabel: conversationLabel(conversation),
          taskNumber: conversation.task?.number ?? null,
          regNumber: conversation.letter?.regNumber ?? null,
          messageId: doc.id,
          seq: doc.seq ?? 1,
          threadRootId: doc.threadRootId ?? null,
          authorId: doc.authorId,
          authorName: doc.authorName,
          createdAt: doc.sourceCreatedAt,
        },
      };
    }
    case 'project':
      return {
        ...base,
        type: 'project',
        meta: { code: doc.code ?? null, status: doc.status ?? 'active' },
      };
    case 'employee':
      return {
        ...base,
        type: 'employee',
        meta: {
          positionName: doc.positionName ?? null,
          departmentName: doc.departmentName ?? null,
          email: doc.email ?? null,
        },
      };
  }
}

function inPeriod(doc: MockDocument, request: SearchRequest): boolean {
  if (request.from && doc.sourceCreatedAt.slice(0, 10) < request.from) return false;
  if (request.to && doc.sourceCreatedAt.slice(0, 10) > request.to) return false;
  return true;
}

function projectMatches(doc: MockDocument, request: SearchRequest): boolean {
  if (!request.projectId) return true;
  if (doc.type === 'message' || doc.type === 'employee') return false;
  return doc.projectId === request.projectId;
}

/** Ответ мока: контракт `SearchResponse` (форма и правила — как у сервера). */
export function runMockSearch(request: SearchRequest, actor: MockActor): SearchResponse {
  const started = Date.now();
  const q = normalizeSearchText(request.q);
  const tokens = tokensOf(request.q).filter((token) => !STOPWORDS.has(token));
  if (tokens.length === 0) {
    return {
      items: [],
      nextCursor: null,
      total: 0,
      totalCapped: false,
      facets: { types: {} },
      hint: 'stopwords',
      tookMs: Date.now() - started,
    };
  }

  const documents = mockSearchDocuments(actor).filter(
    (doc) => inPeriod(doc, request) && projectMatches(doc, request),
  );

  // Фасеты — по всем фильтрам, КРОМЕ выбранного types (чипы показывают,
  // что ещё доступно; правило сервера #952).
  const matched = documents
    .map((doc) => scoreDocument(doc, q, tokens))
    .filter((scored): scored is Scored => scored !== null);
  const facets: SearchFacets['types'] = {};
  for (const scored of matched) {
    const type = scored.doc.type;
    facets[type] = (facets[type] ?? 0) + 1;
  }

  const selected = request.types ?? [];
  const hits = matched
    .filter((scored) => selected.length === 0 || selected.includes(scored.doc.type))
    .map((scored) => hitOf(scored, actor, request.q));

  if (request.sort === 'newest') {
    hits.sort(
      (a, b) =>
        b.sourceCreatedAt.localeCompare(a.sourceCreatedAt) ||
        a.type.localeCompare(b.type) ||
        a.id.localeCompare(b.id),
    );
  } else {
    hits.sort(
      (a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
    );
  }

  const total = Math.min(hits.length, SEARCH_LIMITS.totalCap);
  const window = hits.slice(0, SEARCH_LIMITS.windowMax);
  const offset = request.cursor ? Number(request.cursor) || 0 : 0;
  const page = window.slice(offset, offset + request.limit);
  const nextOffset = offset + request.limit;
  return {
    items: page,
    nextCursor: nextOffset < window.length ? String(nextOffset) : null,
    total,
    totalCapped: hits.length > SEARCH_LIMITS.totalCap,
    facets: { types: facets },
    hint: null,
    tookMs: Date.now() - started,
  };
}
