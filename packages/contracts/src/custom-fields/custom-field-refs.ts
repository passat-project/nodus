import { z } from 'zod';

/**
 * Ссылки для показа значений (Р6): деталь сущности несёт `customFieldRefs`,
 * заполненные пачками через порты (сотрудники, подразделения, элементы
 * справочников, контрагенты, задачи, письма, папки). `name: null` —
 * «Запись недоступна» (актёр не видит цель — Р5) или цель удалена
 * (`archived: true` — «Запись удалена», значение не инвалидируется).
 * Строка списка несёт только значения.
 */
export const customFieldRefKindSchema = z.enum([
  'user',
  'department',
  'dictionary_item',
  'project',
  'counterparty',
  'task',
  'letter',
  'node',
]);
export type CustomFieldRefKind = z.infer<typeof customFieldRefKindSchema>;

export const customFieldRefSchema = z.object({
  kind: customFieldRefKindSchema,
  id: z.uuid(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  archived: z.boolean(),
});
export type CustomFieldRef = z.infer<typeof customFieldRefSchema>;
