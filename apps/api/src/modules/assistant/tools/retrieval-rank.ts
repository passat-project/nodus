import { INTENT_TERMS } from './retrieval-lexicon.js';
import type { AssistantToolDefinition, ToolIntent } from './tool-definition.js';
import {
  READ_INTENTS,
  SUBJECT_FAMILY,
  isWriteIntent,
  keyRu,
  matchesIntentPrefix,
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

/** Класс действия из id, если стандарт ещё не заполнен (baseline-каталог). */
export function inferIntent(tool: AssistantToolDefinition): ToolIntent {
  const action = tool.id.split('.').pop() ?? '';
  const known: Record<string, ToolIntent> = {
    list: 'list',
    get: 'get',
    search: 'search',
    find_users: 'search',
    get_user: 'get',
    history: 'history',
    attachments: 'attachments',
    relations: 'relations',
    members: 'members',
    structure: 'structure',
    departments: 'structure',
    stages: 'stages',
    transitions: 'transitions',
    transition: 'transition',
    create: 'create',
    update: 'update',
    send: 'send',
    direct_message: 'send',
    add_member: 'create',
    add_node: 'create',
    extract_text: 'get',
    conversations: 'list',
    messages: 'list',
    task_conversation: 'get',
    process_types: 'list',
    items: 'list',
    open_entity: 'open',
    save: 'remember',
    forget: 'forget',
  };
  if (known[action]) return known[action]!;
  if (tool.id === 'context.get') return 'context';
  if (tool.id === 'tools.search') return 'search';
  return tool.kind === 'write' ? 'update' : 'list';
}

/** Объект действия из модуля/id, если стандарт ещё не заполнен. */
export function inferSubject(tool: AssistantToolDefinition): string {
  const action = tool.id.split('.').pop() ?? '';
  if (tool.module === 'tasks') return 'задача';
  if (tool.module === 'projects') {
    if (action === 'add_node') return 'папка';
    if (action === 'add_member' || action === 'members') return 'участник';
    if (action === 'structure') return 'структура';
    return 'проект';
  }
  if (tool.module === 'letters') {
    if (action === 'attachments') return 'вложение';
    if (action === 'relations') return 'связь';
    // Переход/резолюция действуют на письмо: отказ «нет письма» по объекту
    // не должен ломать регистрацию.
    return 'письмо';
  }
  if (tool.module === 'chat') {
    if (action === 'conversations') return 'беседа';
    if (action === 'task_conversation') return 'чат';
    if (action === 'direct_message') return 'личное сообщение';
    return 'сообщение';
  }
  if (tool.module === 'directory') {
    if (tool.id === 'me.get') return 'профиль';
    if (action === 'departments') return 'подразделение';
    return 'сотрудник';
  }
  if (tool.module === 'dictionaries') return 'справочник';
  if (tool.module === 'workflows') return 'процесс';
  if (tool.module === 'files') return 'файл';
  if (tool.id === 'ui.open_entity') return 'ссылка';
  if (tool.id === 'tools.search') return 'каталог';
  if (tool.id === 'context.get') return 'контекст';
  if (tool.id.startsWith('memory.')) return 'заметка';
  if (tool.module === 'ext') return 'интернет';
  return 'портал';
}

function sameFamily(a: string, b: string): boolean {
  return (SUBJECT_FAMILY[a] ?? a) === (SUBJECT_FAMILY[b] ?? b);
}

/** Объект инструмента с учётом смежных объектов («участник» → беседа/проект). */
function subjectMatches(tool: AssistantToolDefinition, value: string): boolean {
  const subject = tool.subject ?? inferSubject(tool);
  if (sameFamily(value, subject)) return true;
  return (tool.alsoSubjects ?? []).some((alias) => sameFamily(value, alias));
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
    score += 4;
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

/** Приоритет объекта, когда в запросе упомянуто несколько сущностей. */
const SUBJECT_PRIORITY = [
  'доступ',
  'реакция',
  'папка',
  'портфель',
  'тип проекта',
  'участник',
  'резолюция',
  'переход',
  'заметка',
  'стадия',
  'вложение',
  'файл',
  'текст',
  'сообщение',
  'чат',
  'письмо',
  'задача',
  'проект',
  'сотрудник',
  'подразделение',
  'справочник',
  'элемент',
  'процесс',
  'структура',
  'история',
  'связь',
  'контекст',
  'ссылка',
  'профиль',
] as const;

/** Для этих действий объект задан самим действием, а не темой разговора. */
const ACTION_SUBJECT: Partial<Record<ToolIntent, string>> = {
  context: 'контекст',
  remember: 'заметка',
  forget: 'заметка',
};

function primarySubjects(query: QueryUnderstanding): Set<string> {
  // «Напиши Петрову» — личное сообщение; «отправь в чат» — сообщение в беседу.
  if (query.intents.has('send')) {
    return new Set([query.personName ? 'личное сообщение' : 'сообщение']);
  }
  for (const intent of query.intents) {
    const override = ACTION_SUBJECT[intent];
    // «Сохрани черновик» содержит «сохрани», но объект назван явно: override
    // заметки не должен подменять сообщение беседы.
    if (override && (query.subjects.size === 0 || query.subjects.has(override))) {
      return new Set([override]);
    }
  }
  if (query.subjects.size === 0) return new Set();
  const sorted = [...query.subjects].sort(
    (a, b) => priorityOf(a) - priorityOf(b) || a.localeCompare(b),
  );
  return new Set([sorted[0]!]);
}

function priorityOf(subject: string): number {
  const index = SUBJECT_PRIORITY.indexOf(subject as (typeof SUBJECT_PRIORITY)[number]);
  return index === -1 ? SUBJECT_PRIORITY.length : index;
}

/**
 * Есть ли в каталоге операция под запрошенное действие (#926, «право не
 * знать»). Если сотрудник просит создать проект, а `projects.create` ещё нет,
 * диспетчер не должен «натягивать» `projects.add_node`: это другая операция.
 * Проверка выводится из каталога, а не из списка дыр: появился инструмент —
 * отказ исчез сам.
 */
export function hasCapability(
  catalog: readonly AssistantToolDefinition[],
  query: QueryUnderstanding,
): boolean {
  const writeIntents = [...query.intents].filter(isWriteIntent);
  if (writeIntents.length === 0) return true;
  const actions = actionTokensOf(query);
  // «Создай проект» требует объект «проект», иначе create-папка «натянется» на
  // создание проекта. Для глаголов без названного объекта («добавь Петрова в
  // беседу») объект задаёт сам инструмент — проверяем действие и модуль.
  const created = query.createdObject;
  return writeIntents.some((intent) => {
    if (intent === 'send') {
      // Почта портала не отправляется ассистентом; чат — отправляется.
      if (query.modules.has('letters')) return false;
      return catalog.some(
        (tool) => (tool.intent ?? inferIntent(tool)) === 'send' && actionSupported(tool, actions),
      );
    }
    return catalog.some((tool) => {
      if ((tool.intent ?? inferIntent(tool)) !== intent) return false;
      if (!actionSupported(tool, actions)) return false;
      if (created) {
        if (!subjectMatches(tool, created)) return false;
      }
      if (
        query.modules.size > 0 &&
        tool.module !== 'system' &&
        !query.modules.has(tool.module) &&
        // «Вложения письма» живут в files, «чат задачи» — в chat: модуль
        // инструмента может быть смежным, отказ по нему не делаем.
        !(query.modules.has('files') && tool.module === 'letters') &&
        !(query.modules.has('tasks') && tool.module === 'chat')
      ) {
        return false;
      }
      return true;
    });
  });
}

/** Слова запроса, которые являются глаголом запрошенного действия. */
function actionTokensOf(query: QueryUnderstanding): string[] {
  const prefixes = INTENT_TERMS.filter(
    (group) => isWriteIntent(group.intent) && query.intents.has(group.intent),
  ).flatMap((group) => group.prefixes);
  return query.tokens.filter((token) =>
    prefixes.some((prefix) => matchesIntentPrefix(token, prefix)),
  );
}

/**
 * Глагол действия должен быть в описании инструмента: «архивируй» не
 * поддержано, даже если «изменить проект» есть. Иначе каталог обещает то,
 * чего операция не умеет.
 */
function actionSupported(tool: AssistantToolDefinition, actions: readonly string[]): boolean {
  if (actions.length === 0) return true;
  const index = indexOf(tool);
  const fields = [
    ...index.title,
    ...index.keywords,
    ...index.whenToUse,
    ...index.why,
    ...index.description,
  ];
  return actions.some((token) => fields.includes(keyRu(token)));
}

/** Детерминированный симулятор диспетчера: top-7 выше порога. */
export function simulateRouter(
  catalog: readonly AssistantToolDefinition[],
  query: string,
  limit = 7,
): AssistantToolDefinition[] {
  const understanding = understandQuery(query);
  if (!hasCapability(catalog, understanding)) return [];
  return rankTools(catalog, understanding)
    .filter((entry) => !structurallyWrong(entry.tool, understanding))
    .filter((entry) => entry.score >= ROUTER_SIM_MIN_SCORE)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.tool);
}
