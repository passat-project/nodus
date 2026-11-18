import { SUBJECT_FAMILY } from './retrieval-lexicon.js';
import type { AssistantToolDefinition, ToolIntent } from './tool-definition.js';
import type { QueryUnderstanding } from './retrieval-lang.js';

/**
 * Выводы из каталога, когда стандарт описания ещё не заполнен (#926,
 * baseline-каталог): класс действия и объект по id/модулю. Новые инструменты
 * задают `intent`/`subject` в `meta`; для остальных работает этот слой.
 */

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

export function sameFamily(a: string, b: string): boolean {
  return (SUBJECT_FAMILY[a] ?? a) === (SUBJECT_FAMILY[b] ?? b);
}

/** Объект инструмента с учётом смежных объектов («участник» → беседа/проект). */
export function subjectMatches(tool: AssistantToolDefinition, value: string): boolean {
  const subject = tool.subject ?? inferSubject(tool);
  if (sameFamily(value, subject)) return true;
  return (tool.alsoSubjects ?? []).some((alias) => sameFamily(value, alias));
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

export function primarySubjects(query: QueryUnderstanding): Set<string> {
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
