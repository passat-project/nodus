import { z } from 'zod';

import { stageColorSchema } from '../workflows/workflow-primitives.schemas.js';

/**
 * Ссылки для показа значений (Р6): деталь сущности несёт `customFieldRefs`,
 * заполненные пачками через порты (сотрудники, подразделения, элементы
 * справочников, контрагенты, задачи, письма, папки). `name: null` —
 * «Запись недоступна» (актёр не видит цель — Р5) или цель удалена
 * (`archived: true` — «Запись удалена», значение не инвалидируется).
 * `color` — только у вариантов списков (dictionary_item): ключ палитры
 * темы для подкраски чипов (Р6 #631); у остальных ссылок отсутствует.
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
  /** Цвет варианта списка (только dictionary_item, Р6 #631). */
  color: stageColorSchema.nullable().optional(),
});
export type CustomFieldRef = z.infer<typeof customFieldRefSchema>;
