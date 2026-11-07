import { z } from 'zod';

import { formulaNodeSchema } from './formula.js';

/**
 * Слот формы места (#631, ADR-0037 п.2): видимость атрибута в форме создания
 * места (вид папки, тип проекта) задаётся привязкой + состоянием слота —
 * модель Jira field configuration (скрыть у одного типа, показать у другого).
 * Один контракт-слот для всех мест: «привязан и скрыт» = значение живёт, поле
 * не спрашивается (эквивалент старого глобального hidden, О2).
 */

/** Состояние атрибута в форме места: «скрыто» — не спрашивается при создании,
 *  но видно и правится в карточке; «по желанию» и «обязательно» — в окне. */
export const fieldFormStateSchema = z.enum(['hidden', 'optional', 'required']);
export type FieldFormState = z.infer<typeof fieldFormStateSchema>;

/** Слот: атрибут × состояние. `fieldId` — определение из реестра портала.
 *  `formula` (#632, Р6) — формула по умолчанию у типа/вида: действует для
 *  записей без своего значения и своей формулы, вычисляется на чтении. */
export const fieldFormSlotSchema = z
  .object({
    fieldId: z.uuid(),
    state: fieldFormStateSchema,
    formula: formulaNodeSchema.nullable().optional(),
  })
  .strict();
export type FieldFormSlot = z.infer<typeof fieldFormSlotSchema>;

/** Дублей fieldId в форме быть не может (проверяют схемы мест). */
export function hasDuplicateSlots(slots: readonly FieldFormSlot[]): boolean {
  const ids = slots.map((slot) => slot.fieldId);
  return new Set(ids).size !== ids.length;
}
