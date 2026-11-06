import { z } from 'zod';

/**
 * Каталог событий атрибутов (#431/#631, ADR-0029/0037, I9). Каталожное
 * событие — без `audience`: gateway рассылает его всем авторизованным
 * сокетам (как `workflow.*`), клиенты инвалидируют определения и блок
 * «Атрибуты» карточек. Payload минимальный: подробности — GET
 * /custom-fields/definitions.
 */
export const CUSTOM_FIELD_EVENTS = {
  DEFINITION_CHANGED: 'custom_field.definition_changed',
  /** Формула ячейки поставлена/снята или сменилось её состояние ошибки
   *  (#632, O4): АДРЕСНОЕ событие с аудиторией хоста — каталожный broadcast
   *  раскрывал бы hostId конфиденциальных записей. Эмитит модуль-владелец
   *  хоста; фронт инвалидирует деталь/списки (значок fx и бейдж ошибки). */
  FORMULA_CHANGED: 'custom_field.formula_changed',
} as const;

export type CustomFieldEventType = (typeof CUSTOM_FIELD_EVENTS)[keyof typeof CUSTOM_FIELD_EVENTS];

/** Каталожные события (всем сокетам): formula_changed сюда НЕ входит (O4). */
export const CUSTOM_FIELD_CATALOG_EVENTS: readonly string[] = [
  CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED,
];

/** Payload `custom_field.formula_changed` (#632, O4): без значений, только
 *  факт и состояние ошибки — значения приезжают событием хоста. */
export const customFieldFormulaChangedPayloadSchema = z.object({
  hostKind: z.enum(['task', 'letter', 'node', 'project']),
  hostId: z.uuid(),
  fieldId: z.uuid(),
  /** true — у формулы есть ошибка ячейки (бейдж «!»). */
  hasError: z.boolean(),
});
export type CustomFieldFormulaChangedPayload = z.infer<
  typeof customFieldFormulaChangedPayloadSchema
>;

export const customFieldChangeKindSchema = z.enum(['created', 'updated', 'deleted', 'reordered']);
export type CustomFieldChangeKind = z.infer<typeof customFieldChangeKindSchema>;

export const customFieldDefinitionChangedPayloadSchema = z.object({
  definitionId: z.uuid(),
  change: customFieldChangeKindSchema,
  /** Изменённые ключи свойств определения (updated): включая
   *  'companyValue' — значение глобальной переменной (Р7). */
  fields: z.array(z.string()).optional(),
});
export type CustomFieldDefinitionChangedPayload = z.infer<
  typeof customFieldDefinitionChangedPayloadSchema
>;
