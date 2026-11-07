import { z } from 'zod';

import { letterRegistrationInputSchema } from '../correspondence/letter-registration.schemas.js';
import { customFieldKeySchema } from '../custom-fields/custom-field-key.js';
import { formulaNodeSchema } from '../custom-fields/formula.js';
import {
  customFieldValuesInputSchema,
  CUSTOM_FIELD_LIMITS,
} from '../custom-fields/custom-field-values.js';

/**
 * Окно перехода (#380, ADR-0021/ADR-0024): часть документа маршрута —
 * настройка публикуется вместе с кнопкой и исполняется движком в той же
 * транзакции, что и переход. Реестр разделов ЗАКРЫТ (ADR-0020): новый вид =
 * расширение union + обработчик в вебе и сервере; неизвестный `kind`
 * отвергается при чтении (правило в данных без исполнителя — ложная
 * безопасность). Обязательность содержимого — у ГЕЙТОВ (Р3 плана #380):
 * раздел говорит, что окно ПОКАЗЫВАЕТ, а блокирует переход валидатор.
 */

/** Поля карточки, доступные для дозаполнения в окне. `result` сюда не входит —
 *  у итога свой раздел; `assignee` в теле перехода — `assigneeId`. */
export const transitionWindowFieldSchema = z.enum([
  'description',
  'deadline',
  'assignee',
  'plannedMinutes',
]);
export type TransitionWindowField = z.infer<typeof transitionWindowFieldSchema>;

/** Ключ поля раздела: системное поле или кастомное `cf.<uuid>` (#431, Р7).
 *  Union — надмножество: документы маршрутов до #431 остаются валидными. */
export const transitionWindowFieldKeySchema = z.union([
  transitionWindowFieldSchema,
  customFieldKeySchema,
]);
export type TransitionWindowFieldKey = z.infer<typeof transitionWindowFieldKeySchema>;

/** Порядок разделов в окне фиксированный (не порядок массива документа).
 *  `registration` — раздел только писем (#55, O8): ввод регистрации. */
export const TRANSITION_FORM_SECTION_ORDER = [
  'registration',
  'fields',
  'time',
  'result',
  'result_files',
  'result_messages',
  'comment',
] as const;
export type TransitionFormSectionKind = (typeof TRANSITION_FORM_SECTION_ORDER)[number];

const strictLabel = z.string().trim().min(1).max(60);
const draftLabel = z.string().max(60);

/** Раздел окна на границе публикации: подписи обязательны. */
export const transitionFormSectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('registration') }).strict(),
  z
    .object({
      kind: z.literal('fields'),
      fields: z.array(transitionWindowFieldKeySchema).min(1).max(CUSTOM_FIELD_LIMITS.windowFields),
      /** Формулы-подстановки полей окна (#632, Р12): ключ — поле раздела,
       *  значение считается при открытии окна; человек может поправить,
       *  сохраняется значением (снимок в журнале перехода). */
      formulas: z.record(z.string(), formulaNodeSchema).optional(),
    })
    .strict()
    .refine((v) => new Set(v.fields).size === v.fields.length, { message: 'duplicate fields' })
    .refine(
      (v) =>
        Object.keys(v.formulas ?? {}).every((key) =>
          v.fields.includes(key as TransitionWindowFieldKey),
        ),
      { message: 'formula for unknown field' },
    ),
  z.object({ kind: z.literal('time'), mode: z.enum(['if_empty', 'always']) }).strict(),
  z.object({ kind: z.literal('result') }).strict(),
  z.object({ kind: z.literal('result_files'), label: strictLabel }).strict(),
  z.object({ kind: z.literal('result_messages'), required: z.boolean() }).strict(),
  z.object({ kind: z.literal('comment'), label: strictLabel, required: z.boolean() }).strict(),
]);
export type TransitionFormSection = z.infer<typeof transitionFormSectionSchema>;

/** Раздел черновика редактора: подпись может быть пустой — её ловит
 *  `checkWorkflowDocument` (form_empty_label), а не zod. */
export const transitionFormSectionDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('registration') }).strict(),
  z
    .object({
      kind: z.literal('fields'),
      fields: z.array(transitionWindowFieldKeySchema).min(1).max(CUSTOM_FIELD_LIMITS.windowFields),
      formulas: z.record(z.string(), formulaNodeSchema).optional(),
    })
    .strict()
    .refine((v) => new Set(v.fields).size === v.fields.length, { message: 'duplicate fields' })
    .refine(
      (v) =>
        Object.keys(v.formulas ?? {}).every((key) =>
          v.fields.includes(key as TransitionWindowFieldKey),
        ),
      { message: 'formula for unknown field' },
    ),
  z.object({ kind: z.literal('time'), mode: z.enum(['if_empty', 'always']) }).strict(),
  z.object({ kind: z.literal('result') }).strict(),
  z.object({ kind: z.literal('result_files'), label: draftLabel }).strict(),
  z.object({ kind: z.literal('result_messages'), required: z.boolean() }).strict(),
  z.object({ kind: z.literal('comment'), label: draftLabel, required: z.boolean() }).strict(),
]);
export type TransitionFormSectionDraft = z.infer<typeof transitionFormSectionDraftSchema>;

/** `{}` → { enabled: false, sections: [] } (колонка БД с DEFAULT '{}'). */
export const transitionFormSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Пусто — заголовок окна = название кнопки. */
    title: z.string().trim().max(60).optional(),
    sections: z.array(transitionFormSectionSchema).max(12).default([]),
  })
  .strict();
export type TransitionForm = z.infer<typeof transitionFormSchema>;

export const transitionFormDraftSchema = z
  .object({
    enabled: z.boolean().default(false),
    title: z.string().max(60).optional(),
    sections: z.array(transitionFormSectionDraftSchema).max(12).default([]),
  })
  .strict();
export type TransitionFormDraft = z.infer<typeof transitionFormDraftSchema>;

export const DEFAULT_TRANSITION_FORM = { enabled: false, sections: [] } as const;

/** Введённое в окне (тело выполнения перехода). Время — копия
 *  `timeEntryCreateBodySchema` без импорта из `tasks/*`: иначе цикл
 *  `workflow.schemas → task.schemas → workflow.schemas`. Поведение совпадает
 *  (тест паритета). Кастомные поля — общая форма значений по id определения
 *  (#431); `cf.<id>` в теле не передаётся. `registration` — ввод раздела
 *  «Регистрация» кнопки письма (#55, Р1). */
export const transitionFormInputSchema = z
  .object({
    registration: letterRegistrationInputSchema.optional(),
    fields: z
      .object({
        description: z.string().trim().min(1).max(5000).optional(),
        deadline: z.iso.datetime().optional(),
        assigneeId: z.uuid().optional(),
        plannedMinutes: z.number().int().min(1).max(100_000).optional(),
        customFields: customFieldValuesInputSchema.optional(),
      })
      .strict()
      .refine(
        (v) =>
          [v.description, v.deadline, v.assigneeId, v.plannedMinutes].some(
            (value) => value !== undefined,
          ) ||
          (v.customFields !== undefined && Object.keys(v.customFields).length > 0),
        { message: 'empty fields' },
      )
      .optional(),
    time: z
      .object({
        minutes: z.number().int().min(1).max(1440),
        date: z.iso.date(),
        comment: z.string().trim().max(500).optional(),
      })
      .strict()
      .optional(),
    result: z
      .object({
        text: z.string().trim().max(5000),
        messageIds: z.array(z.uuid()).max(50),
      })
      .strict()
      .refine((v) => new Set(v.messageIds).size === v.messageIds.length, {
        message: 'duplicate message ids',
      })
      .optional(),
    comment: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export type TransitionFormInput = z.infer<typeof transitionFormInputSchema>;
