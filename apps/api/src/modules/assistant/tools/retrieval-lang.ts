import {
  COMPLETE_WORDS,
  CREATED_SUBJECTS,
  CREATION_VERBS,
  DEICTIC_TERMS,
  INTENT_TERMS,
  MODULE_TERMS,
  PHRASE_INTENTS,
  STOP_WORDS,
  SUBJECT_TERMS,
  TYPO_FIXES,
} from './retrieval-lexicon.js';
import type { ToolIntent } from './tool-definition.js';

/** Семья объекта нужна скореру: реэкспорт из данных лексики. */
export { SUBJECT_FAMILY } from './retrieval-lexicon.js';

/**
 * Языковой слой выбора инструмента (#926): нормализация живой русской фразы,
 * основы слов, модули/объекты/классы действия и понимание запроса. Оценка и
 * ранжирование — в `retrieval-rank.ts`; публичный вход один — `retrieval.ts`.
 */

/** Версия алгоритма: печатается в отчёте, чтобы до/после были сопоставимы. */
export const RETRIEVAL_VERSION = '1.0.0';

export interface QueryUnderstanding {
  normalized: string;
  /** Значимые токены (без стоп-слов). */
  tokens: readonly string[];
  stems: ReadonlySet<string>;
  modules: ReadonlySet<string>;
  intents: ReadonlySet<ToolIntent>;
  subjects: ReadonlySet<string>;
  deictic: boolean;
  entityNumber: boolean;
  /** В запросе назван человек («Петров») — для поиска сотрудника, не профиля. */
  personName: boolean;
  /** Запрос о себе: «мой», «моя», «кто я». */
  selfReference: boolean;
  /** Назван объект в кавычках («Северный») — повод искать его в списке. */
  namedEntity: boolean;
  /**
   * Объект, который прямо просят создать («создай папку» → «папка»):
   * главный довод против соседнего инструмента с другим объектом.
   */
  createdObject: string | null;
}

/** Нормализация: нижний регистр, ё→е, пунктуация → пробел. */
export function normalizeQuery(text: string): string {
  let lowered = text.toLowerCase().replace(/ё/g, 'е');
  for (const [pattern, replacement] of TYPO_FIXES) {
    lowered = lowered.replace(pattern, replacement);
  }
  return ` ${lowered
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

const ENDINGS = [
  'ами',
  'ями',
  'ого',
  'его',
  'ому',
  'ему',
  'ыми',
  'ими',
  'иях',
  'иям',
  'ов',
  'ев',
  'ий',
  'ый',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ой',
  'ей',
  'ом',
  'ем',
  'ах',
  'ях',
  'ам',
  'ям',
  'ую',
  'юю',
  'а',
  'я',
  'ы',
  'и',
  'о',
  'е',
  'у',
  'ю',
  'ь',
] as const;

/** Грубая основа русской словоформы: «задачами» → «задач». */
export function stemRu(word: string): string {
  const normalized = word.toLowerCase().replace(/ё/g, 'е');
  // Порог 3, а не 4: короткие словоформы «чате», «акте», «смета» тоже несут
  // окончание, и без снятия «чат» не равнялся «чате».
  if (normalized.length <= 3) return normalized;
  for (const ending of ENDINGS) {
    if (normalized.endsWith(ending) && normalized.length - ending.length >= 3) {
      return normalized.slice(0, normalized.length - ending.length);
    }
  }
  return normalized;
}

/**
 * Ключ сравнения: первые 4 буквы основы. Русская морфология даёт разные
 * основы у глаголов («напиши»/«написать» → «напиш»/«напис»), а модели нужен
 * один смысл; 4 буквы стабильно склеивают словоформы и почти не дают
 * ложных пар на нашем словаре.
 */
export function keyRu(word: string): string {
  // Мягкий знак в опечатках часто пропускают («писмо» ↔ «письмо»).
  const stem = stemRu(word).replace(/ь/gu, '');
  return stem.length > 4 ? stem.slice(0, 4) : stem;
}

export function words(normalized: string): string[] {
  return normalized.trim().split(' ').filter(Boolean);
}

function termMatchesToken(token: string, term: string): boolean {
  const stem = stemRu(token);
  if (stem === term) return true;
  return term.length >= 5 && stem.startsWith(term);
}

function hasTerm(normalized: string, tokens: readonly string[], term: string): boolean {
  if (term.includes(' ')) return normalized.includes(term);
  return tokens.some((token) => termMatchesToken(token, term));
}

export function matchesIntentPrefix(token: string, prefix: string): boolean {
  if (token === prefix) return true;
  if (COMPLETE_WORDS.has(prefix)) return token === `${prefix}те`;
  return token.startsWith(prefix);
}

function detectIntent(normalized: string, tokens: readonly string[]): Set<ToolIntent> {
  const intents = new Set<ToolIntent>();
  for (const group of INTENT_TERMS) {
    if (
      group.prefixes.some((prefix) => tokens.some((token) => matchesIntentPrefix(token, prefix)))
    ) {
      intents.add(group.intent);
    }
  }
  for (const group of PHRASE_INTENTS) {
    if (group.phrases.some((phrase) => normalized.includes(phrase))) intents.add(group.intent);
  }
  // «Что дальше можно сделать с письмом» — вопрос о переходах, а не просьба
  // изменить: глагол «сделать» здесь служебный и не должен включать update.
  if (intents.has('transitions') && /что\s+(?:[а-я]+\s+){0,3}сделать/.test(normalized)) {
    intents.delete('create');
    intents.delete('update');
  }
  if (intents.has('transitions') && intents.has('create')) {
    const hasCreationVerb = tokens.some(
      (token) =>
        token.startsWith('созда') ||
        token === 'заведи' ||
        token === 'завести' ||
        token.startsWith('сформиру') ||
        token.startsWith('добав') ||
        token.startsWith('назнач'),
    );
    if (!hasCreationVerb) intents.delete('create');
  }
  if (intents.has('transition')) {
    // Переход выполняется только после чтения доступных переходов: оба
    // инструмента обязаны быть в наборе.
    intents.add('transitions');
  }
  return intents;
}

/** Объект создания («создай папку» → «папка»): сильный признак против соседей. */
function detectCreatedObject(normalized: string): string | null {
  const match = CREATION_VERBS.exec(normalized);
  if (!match?.[1]) return null;
  const probe = normalizeQuery(match[1]);
  const [token] = words(probe);
  if (!token) return null;
  for (const entry of SUBJECT_TERMS) {
    if (entry.terms.some((term) => hasTerm(probe, [token], term))) {
      return CREATED_SUBJECTS.has(entry.subject) ? entry.subject : null;
    }
  }
  return null;
}

export function understandQuery(text: string): QueryUnderstanding {
  const normalized = normalizeQuery(text);
  const allTokens = words(normalized);
  const tokens = allTokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  const modules = new Set<string>();
  for (const [module, terms] of Object.entries(MODULE_TERMS)) {
    if (terms.some((term) => hasTerm(normalized, allTokens, term))) modules.add(module);
  }
  const subjects = new Set<string>();
  for (const entry of SUBJECT_TERMS) {
    if (entry.terms.some((term) => hasTerm(normalized, allTokens, term))) {
      subjects.add(entry.subject);
    }
  }
  const intents = detectIntent(normalized, allTokens);
  const entityNumber = /№\s*\d+|(?:задач|письм|проект|бесед)[а-я]*\s+\d{2,}/u.test(normalized);
  if (entityNumber) intents.add('get');
  if (subjects.has('профиль')) intents.add('get');
  const deictic = DEICTIC_TERMS.some((term) => normalized.includes(term));
  const personName = detectPersonName(text);
  if (personName) {
    subjects.add('сотрудник');
    modules.add('directory');
  }
  const selfReference = /(^|\s)(я|мой|моя|мои|мое|мне|меня|кто я)(\s|$)/u.test(normalized);
  const namedEntity = /«[^»]+»|"[^"]+"/u.test(text);
  const createdObject = detectCreatedObject(normalized);
  return {
    normalized,
    tokens,
    stems: new Set(tokens.map(keyRu)),
    modules,
    intents,
    subjects,
    deictic,
    entityNumber,
    personName,
    selfReference,
    namedEntity,
    createdObject,
  };
}

/**
 * Имя человека в запросе: слово с заглавной буквы вне кавычек («объект
 * «Северный»» — не человек). Фамилия первым словом («Петров, кто это?»)
 * узнаётся по типичному окончанию.
 */
function detectPersonName(text: string): boolean {
  const withoutQuotes = text.replace(/«[^»]*»|"[^"]*"/g, ' ');
  const raw = withoutQuotes.trim().split(/\s+/);
  return raw.some((word, index) => {
    const clean = word.replace(/[^\p{L}-]/gu, '');
    if (!/^[А-ЯЁ][а-яё-]{2,}$/u.test(clean)) return false;
    if (index > 0) return true;
    return /(ов|ев|ёв|ин|ын|ко|ук|юк|ич)$/iu.test(clean);
  });
}

const WRITE_INTENTS: ReadonlySet<ToolIntent> = new Set([
  'create',
  'update',
  'delete',
  'transition',
  'send',
  'remember',
  'forget',
]);

/** Классы чтения: запрос с ними и без единой записи — чисто читательский. */
export const READ_INTENTS: ReadonlySet<ToolIntent> = new Set([
  'list',
  'get',
  'search',
  'history',
  'attachments',
  'relations',
  'members',
  'structure',
  'stages',
  'transitions',
  'open',
  'context',
]);

export function isWriteIntent(intent: ToolIntent): boolean {
  return WRITE_INTENTS.has(intent);
}

/**
 * Структурно неверный инструмент не должен попадать даже в полку кандидатов:
 * просьба «покажи» не предлагает запись, а «создай проект» — создание папки
 * или портфеля. Это фильтр, а не штраф: соседний объект здесь не «почти
 * подходит», а делает не то, о чём попросили.
 */
