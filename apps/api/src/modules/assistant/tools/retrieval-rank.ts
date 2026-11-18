import { inferIntent, primarySubjects, subjectMatches } from './retrieval-infer.js';
import type { AssistantToolDefinition } from './tool-definition.js';
import {
  READ_INTENTS,
  isWriteIntent,
  keyRu,
  normalizeQuery,
  understandQuery,
  words,
  type QueryUnderstanding,
} from './retrieval-lang.js';

/**
 * Оценка и ранжирование инструментов (#926): совпадения по id/названию/
 * ключевым словам/«когда вызывать», бонус модуля и объекта, штраф за неверный
 * класс действия, структурные фильтры и симулятор диспетчера.
 */

/** Порог диспетчера: ниже — инструмент не активируется (шум мешает модели). */
export const ROUTER_SIM_MIN_SCORE = 14;

/** Порог поиска второй полки: слабые совпадения не активируем (шум). */
export const SEARCH_MIN_SCORE = 6;

export function structurallyWrong(
  tool: AssistantToolDefinition,
  query: QueryUnderstanding,
): boolean {
  const intent = tool.intent ?? inferIntent(tool);
  const values = [...query.intents];
  const readOnlyQuery =
    values.some((value) => READ_INTENTS.has(value)) && !values.some(isWriteIntent);
  if (readOnlyQuery && tool.kind === 'write') return true;
  if (
    query.createdObject &&
    tool.kind === 'write' &&
    isWriteIntent(intent) &&
    intent !== 'send' &&
    ['create', 'update', 'delete', 'transition'].includes(intent) &&
    !subjectMatches(tool, query.createdObject)
  ) {
    return true;
  }
  return false;
}

interface IndexedTool {
  id: readonly string[];
  title: readonly string[];
  keywords: readonly string[];
  whenToUse: readonly string[];
  why: readonly string[];
  description: readonly string[];
}

const FIELD_WEIGHTS = {
  id: 5,
  title: 4,
  keywords: 3,
  whenToUse: 3,
  why: 2,
  description: 1,
} as const;
const FIELD_CAPS = {
  id: 2,
  title: 3,
  keywords: 4,
  whenToUse: 4,
  why: 3,
  description: 3,
} as const;

const INDEX_CACHE = new WeakMap<AssistantToolDefinition, IndexedTool>();

function indexOf(tool: AssistantToolDefinition): IndexedTool {
  const cached = INDEX_CACHE.get(tool);
  if (cached) return cached;
  const build = (text: string): string[] => words(normalizeQuery(text)).map(keyRu);
  const index: IndexedTool = {
    id: build(tool.id.replace(/[._]/g, ' ')),
    title: build(tool.title),
    keywords: build((tool.keywords ?? []).join(' ')),
    whenToUse: build(tool.whenToUse ?? ''),
    why: build(tool.why ?? ''),
    description: build(tool.description),
  };
  INDEX_CACHE.set(tool, index);
  return index;
}

function fieldHits(stems: ReadonlySet<string>, field: readonly string[], cap: number): number {
  let hits = 0;
  for (const stem of stems) {
    if (hits >= cap) break;
    if (field.includes(stem)) hits += 1;
  }
  return hits;
}

/**
 * Оценка инструмента под запрос. Возвращается число без нормализации: оно
 * нужно только для ранжирования и порога диспетчера.
 */
export function scoreTool(tool: AssistantToolDefinition, query: QueryUnderstanding): number {
  const index = indexOf(tool);
  let score = 0;
  for (const field of ['id', 'title', 'keywords', 'whenToUse', 'why', 'description'] as const) {
    score += fieldHits(query.stems, index[field], FIELD_CAPS[field]) * FIELD_WEIGHTS[field];
  }

  if (query.modules.size > 0) {
    if (query.modules.has(tool.module)) score += 8;
    else if (
      tool.module !== 'system' &&
      // «Напиши Петрову про задачу»: тема разговора — задача, действие — чат.
      !(tool.module === 'chat' && query.intents.has('send'))
    ) {
      score -= 6;
    }
  }

  const subjects = primarySubjects(query);
  const hasActionOverride = query.intents.has('send') || query.intents.has('open');
  const intent = tool.intent ?? inferIntent(tool);
  if (subjects.size > 0) {
    if ([...subjects].some((value) => subjectMatches(tool, value))) {
      score += 6;
    } else if (
      !hasActionOverride &&
      [...query.subjects].some((value) => subjectMatches(tool, value))
    ) {
      // «Задачи по объекту»: проект — контекст, но projects.list тоже нужен.
      score += 2;
    } else if (tool.module !== 'system') {
      // «Создай папку» ≠ добавить участника: несовпадение с явно названным
      // объектом создания штрафуется жёстко, обычное несовпадение — мягко
      // («Добавь Петрова в беседу»: участник не назван словом «участник»).
      const createdMismatch =
        query.createdObject !== null &&
        tool.kind === 'write' &&
        intent !== 'send' &&
        !subjectMatches(tool, query.createdObject);
      score -= createdMismatch ? 24 : tool.kind === 'write' ? 10 : 8;
    }
  }

  if (query.intents.size > 0) {
    if (query.intents.has(intent)) {
      score += 6;
      // Точное попадание в записанное действие важнее «полезного чтения»:
      // «напиши Петрову» — это send, а не список задач по теме сообщения.
      if (isWriteIntent(intent) && [...query.intents].some(isWriteIntent)) score += 4;
    } else if (query.intents.has('delete')) score -= 8;
    else if (isWriteIntent(intent) && [...query.intents].some(isWriteIntent)) score -= 18;
    else if (isWriteIntent(intent)) score -= 16;
    else if ([...query.intents].some(isWriteIntent)) score -= 10;
    else score -= 2;
  } else if (tool.kind === 'write') {
    // Запрос без действия («чё по задачам») не повод предлагать создание.
    score -= 10;
  }

  // Названный в кавычках объект («Северный», «Приёмная») ищут списком/карточкой
  // своего модуля, а не соседним действием.
  if (
    query.namedEntity &&
    query.modules.has(tool.module) &&
    !isWriteIntent(intent) &&
    [
      'list',
      'get',
      'search',
      'members',
      'structure',
      'attachments',
      'relations',
      'transitions',
      'stages',
    ].includes(intent)
  ) {
    score += 12;
  }

  // Просьба про содержимое приложенного документа требует и описи вложений.
  if (
    intent === 'attachments' &&
    (query.intents.has('attachments') || query.intents.has('get')) &&
    (query.modules.has('letters') || query.subjects.has('вложение'))
  ) {
    score += 6;
  }

  // Номер сущности («задача №1042») — повод искать и открывать, а не листать.
  if (query.entityNumber && ['search', 'get', 'list'].includes(intent)) {
    if (query.modules.size === 0 || query.modules.has(tool.module)) score += 3;
  }

  if (query.personName) {
    if (tool.id === 'directory.find_users') {
      score += 10;
      // Действие над человеком (написать, добавить, назначить) требует его id:
      // сперва поиск по имени, а не карточка по неизвестному id.
      if (
        [...query.intents].some((value) =>
          ['create', 'update', 'send', 'transition'].includes(value),
        )
      ) {
        score += 12;
      }
    }
    if (tool.id === 'directory.get_user') score += 10;
    if (tool.id === 'directory.departments') score -= 12;
  }
  if (tool.id === 'me.get') {
    // «Кто мой руководитель» — профиль; «карточка сотрудника Петрова» — нет.
    score += query.selfReference ? 10 : -30;
  }
  if (query.intents.has('transition') && intent === 'transitions') score += 2;
  return score;
}

export interface ScoredTool {
  tool: AssistantToolDefinition;
  score: number;
}

/** Все инструменты с оценкой, детерминированный порядок при равенстве. */
export function rankTools(
  catalog: readonly AssistantToolDefinition[],
  query: QueryUnderstanding,
): ScoredTool[] {
  return catalog
    .map((tool) => ({ tool, score: scoreTool(tool, query) }))
    .sort((a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id));
}

/**
 * Лексический поиск второй полки: инструменты с положительной оценкой.
 * Порог не поднимаем — редкий инструмент обязан находиться; отсечку делает
 * диспетчер (`ROUTER_SIM_MIN_SCORE`).
 */
export function searchCatalog(
  catalog: readonly AssistantToolDefinition[],
  query: string,
  limit = 5,
): AssistantToolDefinition[] {
  if (!normalizeQuery(query).trim()) return [];
  const understanding = understandQuery(query);
  return rankTools(catalog, understanding)
    .filter((entry) => !structurallyWrong(entry.tool, understanding))
    .filter((entry) => entry.score >= SEARCH_MIN_SCORE)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.tool);
}
