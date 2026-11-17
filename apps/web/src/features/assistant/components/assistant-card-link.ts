/**
 * Разбор внутренней ссылки карточки из markdown/строки инструмента (#897,
 * находка security-ревью 17.11.2026): href приходит из недоверенного текста
 * (ответ модели пересказывает письма и сообщения), а id подставляется в путь
 * API карточки (`/tasks/<id>`). Поэтому принимаем ТОЛЬКО относительный
 * `?cards=kind:<uuid>`: внешний URL с `cards=` — не карточка, произвольная
 * строка в id — отказ (path traversal в аутентифицированный GET).
 */

/** Виды, которые присылает сервер (`ui.open_entity`) и понимает мост каркаса. */
const CARD_KINDS = new Set([
  'task',
  'project',
  'letter',
  'employee',
  'counterparty',
  'conversation',
  'messenger',
]);

/** id карточки — строгий UUID (как в каноне `app/shell/link-target.ts`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssistantCardRef {
  kind: string;
  id: string;
}

/** `?cards=task:<uuid>` → ref; внешний адрес, чужой вид или не-UUID → null. */
export function cardRefFromHref(href: string): AssistantCardRef | null {
  if (!/^\/?\?/.test(href)) return null;
  const query = href.slice(href.indexOf('?') + 1);
  const value = new URLSearchParams(query).get('cards');
  // Несколько карточек в адресе не поддерживаем: у ассистента одна сущность.
  const ref = value?.split(',').at(-1) ?? '';
  const separator = ref.indexOf(':');
  if (separator <= 0) return null;
  const kind = ref.slice(0, separator);
  const id = ref.slice(separator + 1);
  if (!CARD_KINDS.has(kind) || !UUID_RE.test(id)) return null;
  return { kind, id };
}
