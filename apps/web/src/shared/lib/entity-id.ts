/**
 * Канон идентификатора сущности портала — строгий UUID (api-conventions).
 *
 * Одна константа на все входы, где id приходит из недоверенного текста и
 * дальше подставляется в путь API (`?cards=`, `portal://`, ссылки ассистента,
 * ссылки в сообщениях): три копии регекса неизбежно расходятся, и дрейф одной
 * возвращает path traversal через свой вход (#908).
 *
 * Слой `shared` — база для `features` и `app`, поэтому канон живёт здесь.
 */
export const ENTITY_ID_PATTERN =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const ENTITY_ID_RE = new RegExp(`^${ENTITY_ID_PATTERN}$`);

export function isEntityId(value: string): boolean {
  return ENTITY_ID_RE.test(value);
}
