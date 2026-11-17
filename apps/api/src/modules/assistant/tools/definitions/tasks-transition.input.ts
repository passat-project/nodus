import { z } from 'zod';
import { customFieldValuesInputSchema } from '@nodus/contracts';

/**
 * Вход `tasks.transition` (#920): окно перехода, комментарий и обход гейта.
 * Вынесено из `tasks-transition.tools.ts` по I5; тело `form` уходит в API без
 * преобразований — сервер сверяет состав с эффективным окном (422).
 */

export const transitionFormInput = z.object({
  /** Комментарий перехода (раздел «Комментарий»). */
  comment: z.string().trim().min(1).max(2_000).optional(),
  /** Итог задачи (раздел «Итог»): текст и id сообщений-вложений. */
  result: z
    .object({
      text: z.string().trim().max(5_000),
      messageIds: z.array(z.uuid()).max(50).default([]),
    })
    .optional(),
  /** Трудозатраты (раздел «Время»). */
  time: z
    .object({
      minutes: z.number().int().min(1).max(1_440),
      date: z.iso.date(),
      comment: z.string().trim().max(500).optional(),
    })
    .optional(),
  /** Поля карточки (раздел «Поля»): системные и атрибуты по id определения. */
  fields: z
    .object({
      description: z.string().trim().min(1).max(5_000).optional(),
      deadline: z.iso.datetime().optional(),
      assigneeId: z.uuid().optional(),
      plannedMinutes: z.number().int().min(1).max(100_000).optional(),
      /** Ключи — UUID определений атрибутов (контракт `customFieldValuesInputSchema`). */
      customFields: customFieldValuesInputSchema.optional(),
    })
    .optional(),
});

export type TransitionFormInput = z.infer<typeof transitionFormInput>;

export const transitionInput = z.object({
  id: z.uuid(),
  transitionId: z.uuid(),
  /** Поля окна перехода: сервер валидирует состав (422 при расхождении). */
  form: transitionFormInput.optional(),
  /** Короткая форма комментария (совместимость): уходит в `form.comment`. */
  comment: z.string().trim().max(2_000).optional(),
  /** Обход гейта: только если `tasks.transitions` сказал «можно обойти». */
  override: z.boolean().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

/** Тело `form` без пустых ключей; короткий `comment` уходит в него же. */
export function formBody(
  form: TransitionFormInput | undefined,
  comment: string | undefined,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = { ...(form ?? {}) };
  if (!body.comment && comment) body.comment = comment;
  return Object.keys(body).length > 0 ? body : null;
}
