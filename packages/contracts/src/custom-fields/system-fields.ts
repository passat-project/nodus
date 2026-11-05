/**
 * Системные поля, посеянные миграцией #631 (Р9): шифр проекта, заказчик
 * проекта, код папки — обычные атрибуты реестра с детерминированными id
 * (uuidv5 от фиксированного namespace: сид, тесты и миграция дают одинаковые
 * id во всех средах). Имя — не ключ: администратор может переименовать или
 * удалить (окно последствий честно перечислит эффекты). Ключи значений
 * JSONB и `cf.<uuid>` в маршрутах живут на этих id.
 */
export const SYSTEM_FIELD_IDS = {
  /** «Шифр» (type text) — бывшее системное поле `projects.code`; слот формы
   *  типа проекта сеется из политики `code_field`. */
  projectCode: '4b91bbe0-2d81-5ba2-8c51-93beb41da2cf',
  /** «Заказчик» (type counterparty) — бывшее системное поле `projects.client_id`. */
  projectClient: 'd5298cff-e488-514b-b9c8-ecaafd624b26',
  /** «Код» (type text) — бывшее системное поле `project_nodes.code`;
   *  слот формы вида папки сеется из `config.form.code`. */
  nodeCode: '6ebf0f32-ff97-582e-a1b3-095558c317fa',
} as const;

export type SystemFieldId = (typeof SYSTEM_FIELD_IDS)[keyof typeof SYSTEM_FIELD_IDS];

/** Доступ к значениям системных полей (события проектов — Р9): шифр и
 *  заказчик читаются из customFields проекта по этим id. */
export function systemFieldValue(
  customFields: Readonly<Record<string, unknown>> | null | undefined,
  id: SystemFieldId,
): unknown {
  return customFields?.[id];
}

export function isSystemFieldId(id: string): id is SystemFieldId {
  return Object.values(SYSTEM_FIELD_IDS).includes(id as SystemFieldId);
}
