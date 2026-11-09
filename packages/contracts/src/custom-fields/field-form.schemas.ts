import { z } from 'zod';

import {
  formDecorSchema,
  formFieldLayoutShape,
  isFormDecor,
  type FormDecor,
} from '../forms/form-layout.js';
import { formulaNodeSchema } from './formula.js';

/**
 * Слот формы места (#631, ADR-0037 п.2): видимость атрибута в форме создания
 * места (вид папки, тип проекта) задаётся привязкой + состоянием слота —
 * модель Jira field configuration (скрыть у одного типа, показать у другого).
 * Один контракт-слот для всех мест: «привязан и скрыт» = значение живёт, поле
 * не спрашивается (эквивалент старого глобального hidden, О2).
 *
 * Раскладка окна (#496, Р3): у слота своя подпись в окне, подсказка, ширина
 * и высота; в списке формы рядом со слотами живёт оформление (заголовок,
 * пояснение, отступ). Слоты читаются ТОЛЬКО через `formSlots`.
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
    /** Подпись атрибута в окне (#496); null — имя атрибута. Карточку не
     *  переименовывает. */
    label: z.string().trim().min(1).max(60).nullable().optional(),
    ...formFieldLayoutShape,
  })
  .strict();
export type FieldFormSlot = z.infer<typeof fieldFormSlotSchema>;

/** Элемент формы места: слот атрибута или оформление (#496). */
export const fieldFormElementSchema = z.union([fieldFormSlotSchema, formDecorSchema]);
export type FieldFormElement = FieldFormSlot | FormDecor;

/** Элемент — слот атрибута (не оформление и не системный элемент проекта). */
export function isFieldFormSlot(element: unknown): element is FieldFormSlot {
  return (
    element !== null &&
    typeof element === 'object' &&
    !isFormDecor(element) &&
    typeof (element as { fieldId?: unknown }).fieldId === 'string'
  );
}

/** Слоты атрибутов формы места — ЕДИНСТВЕННЫЙ способ читать слоты (#496,
 *  Пакет 0): оформление и системные элементы проекта отбрасываются. */
export function formSlots(form: { fields: readonly unknown[] }): FieldFormSlot[] {
  return form.fields.filter(isFieldFormSlot);
}

/** Дублей fieldId в форме быть не может (проверяют схемы мест). */
export function hasDuplicateSlots(elements: readonly unknown[]): boolean {
  const ids = elements.filter(isFieldFormSlot).map((slot) => slot.fieldId);
  return new Set(ids).size !== ids.length;
}
