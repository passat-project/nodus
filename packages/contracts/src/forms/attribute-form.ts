import { z } from 'zod';

import {
  fieldFormElementSchema,
  hasDuplicateSlots,
  isFieldFormSlot,
} from '../custom-fields/field-form.schemas.js';
import { FORM_LAYOUT_LIMITS, isFormDecor } from './form-layout.js';

/**
 * Форма атрибутов (#496, Р12): слоты атрибутов с раскладкой и оформление —
 * одна форма для вида папки, типа проекта (плюс системные элементы, см.
 * `projectTypeFormSchema`) и строки реестра (#636). Отдельный модуль, а не
 * `form-layout.ts`: слот живёт в `custom-fields/field-form.schemas.ts`,
 * который сам берёт куски раскладки отсюда — без цикла импортов.
 */

export const ATTRIBUTE_FORM_LIMITS = {
  /** Слотов атрибутов (всех состояний). */
  fields: 30,
  decor: FORM_LAYOUT_LIMITS.decor,
} as const;

/** Проверки состава списка: дубли слотов и лимиты слотов/оформления. */
export function refineAttributeElements(
  elements: readonly unknown[],
  ctx: z.RefinementCtx,
  limits: { fields: number; decor: number } = ATTRIBUTE_FORM_LIMITS,
): void {
  if (hasDuplicateSlots(elements)) {
    ctx.addIssue({ code: 'custom', path: ['fields'], message: 'duplicate field' });
  }
  if (elements.filter(isFieldFormSlot).length > limits.fields) {
    ctx.addIssue({ code: 'custom', path: ['fields'], message: 'too many fields' });
  }
  if (elements.filter(isFormDecor).length > limits.decor) {
    ctx.addIssue({ code: 'custom', path: ['fields'], message: 'too many decor elements' });
  }
}

export const attributeFormSchema = z
  .object({
    fields: z
      .array(fieldFormElementSchema)
      .max(ATTRIBUTE_FORM_LIMITS.fields + ATTRIBUTE_FORM_LIMITS.decor),
  })
  .strict()
  .superRefine((form, ctx) => refineAttributeElements(form.fields, ctx));
export type AttributeForm = z.infer<typeof attributeFormSchema>;
