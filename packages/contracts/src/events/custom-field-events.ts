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
} as const;

export type CustomFieldEventType = (typeof CUSTOM_FIELD_EVENTS)[keyof typeof CUSTOM_FIELD_EVENTS];

export const CUSTOM_FIELD_CATALOG_EVENTS: readonly string[] = [
  CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED,
];

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
