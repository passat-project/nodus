import { z } from 'zod';

import { letterRegistrationInputSchema } from '../correspondence/letter-registration.schemas.js';
import { customFieldKeySchema } from '../custom-fields/custom-field-key.js';
import { formulaNodeSchema } from '../custom-fields/formula.js';
import {
  customFieldValuesInputSchema,
  CUSTOM_FIELD_LIMITS,
} from '../custom-fields/custom-field-values.js';
import { formLocksSchema } from '../forms/field-lock.js';
import {
  FORM_LAYOUT_LIMITS,
  formDecorSchema,
  formFieldLayoutShape,
  formHintSchema,
  isFormDecor,
  type FormDecor,
  type FormFieldLayout,
} from '../forms/form-layout.js';

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

/** Подпись и подсказка блока окна (#496): та же настройка, что у поля.
 *  Пусто — стандартное название раздела из i18n. Схема публикации не
 *  требует непустую подпись: блок — не поле, его подпись не ввод данных. */
const sectionLabel = z.string().trim().max(60);
const sectionLabelDraft = z.string().max(60);

/** Поле окна с раскладкой (#496, Р3): своя подпись в этом окне, подсказка,
 *  ширина и высота. Редактор пишет поля объектами; строка-ключ (наследие
 *  #380/#431) читается вечно как поле на всю строку. */
export const transitionWindowFieldElementSchema = z
  .object({
    key: transitionWindowFieldKeySchema,
    /** Подпись поля в этом окне; null — стандартная (имя атрибута/поля). */
    label: z.string().trim().min(1).max(60).nullable().optional(),
    ...formFieldLayoutShape,
  })
  .strict();
export type TransitionWindowFieldElement = z.infer<typeof transitionWindowFieldElementSchema>;

/** Элемент раздела «Поля»: ключ (наследие), поле-объект или оформление. */
export const transitionWindowElementSchema = z.union([
  transitionWindowFieldKeySchema,
  transitionWindowFieldElementSchema,
  formDecorSchema,
]);
export type TransitionWindowElement = z.infer<typeof transitionWindowElementSchema>;

/** Нормализованный элемент: поле всегда объектом или оформление. */
export type TransitionWindowItem = TransitionWindowFieldElement | FormDecor;

/** Ключи полей раздела без оформления — ЕДИНСТВЕННЫЙ способ читать поля
 *  окна кнопки (#496, Пакет 0): дубли, формулы, гейты, сверка ввода. */
export function windowFieldKeys(section: {
  fields: readonly TransitionWindowElement[];
}): TransitionWindowFieldKey[] {
  return section.fields.flatMap((element) => {
    if (typeof element === 'string') return [element];
    return isFormDecor(element) ? [] : [element.key];
  });
}

/** Элементы раздела в нормализованном виде: строка-ключ → `{ key }`. */
export function windowItems(section: {
  fields: readonly TransitionWindowElement[];
}): TransitionWindowItem[] {
  return section.fields.map((element) =>
    typeof element === 'string' ? { key: element } : element,
  );
}

/** Раскладка поля окна (пусто у строки-ключа: вся строка, без подсказки). */
export function windowFieldLayout(element: TransitionWindowItem): FormFieldLayout {
  return isFormDecor(element) ? {} : element;
}

function checkFieldElements(
  v: { fields: readonly TransitionWindowElement[]; formulas?: Record<string, unknown> },
  ctx: z.RefinementCtx,
): void {
  const keys = windowFieldKeys(v);
  if (keys.length === 0) ctx.addIssue({ code: 'custom', message: 'no fields' });
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: 'custom', message: 'duplicate fields' });
  }
  if (keys.length > CUSTOM_FIELD_LIMITS.windowFields) {
    ctx.addIssue({ code: 'custom', message: 'too many fields' });
  }
  if (v.fields.length - keys.length > FORM_LAYOUT_LIMITS.decor) {
    ctx.addIssue({ code: 'custom', message: 'too many decor elements' });
  }
  if (
    !Object.keys(v.formulas ?? {}).every((key) => keys.includes(key as TransitionWindowFieldKey))
  ) {
    ctx.addIssue({ code: 'custom', message: 'formula for unknown field' });
  }
}

const FIELD_ELEMENTS_MAX = CUSTOM_FIELD_LIMITS.windowFields + FORM_LAYOUT_LIMITS.decor;

/** Раздел окна на границе публикации. */
export const transitionFormSectionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('registration'),
      label: sectionLabel.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('fields'),
      /** Поля и оформление одним списком в порядке окна (#496, Р3). */
      fields: z.array(transitionWindowElementSchema).min(1).max(FIELD_ELEMENTS_MAX),
      /** Формулы-подстановки полей окна (#632, Р12): ключ — поле раздела,
       *  значение считается при открытии окна; человек может поправить,
       *  сохраняется значением (снимок в журнале перехода). */
      formulas: z.record(z.string(), formulaNodeSchema).optional(),
    })
    .strict()
    .superRefine(checkFieldElements),
  z
    .object({
      kind: z.literal('time'),
      mode: z.enum(['if_empty', 'always']),
      label: sectionLabel.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('result'),
      label: sectionLabel.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('result_files'),
      label: sectionLabel.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('result_messages'),
      required: z.boolean(),
      label: sectionLabel.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('comment'),
      label: sectionLabel.optional(),
      required: z.boolean(),
      hint: formHintSchema.optional(),
    })
    .strict(),
]);
export type TransitionFormSection = z.infer<typeof transitionFormSectionSchema>;

/** Раздел черновика редактора: подпись может быть пустой — её ловит
 *  `checkWorkflowDocument` (form_empty_label), а не zod. */
export const transitionFormSectionDraftSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('registration'),
      label: sectionLabelDraft.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('fields'),
      fields: z.array(transitionWindowElementSchema).min(1).max(FIELD_ELEMENTS_MAX),
      formulas: z.record(z.string(), formulaNodeSchema).optional(),
    })
    .strict()
    .superRefine(checkFieldElements),
  z
    .object({
      kind: z.literal('time'),
      mode: z.enum(['if_empty', 'always']),
      label: sectionLabelDraft.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('result'),
      label: sectionLabelDraft.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('result_files'),
      label: sectionLabelDraft.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('result_messages'),
      required: z.boolean(),
      label: sectionLabelDraft.optional(),
      hint: formHintSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('comment'),
      label: sectionLabelDraft.optional(),
      required: z.boolean(),
      hint: formHintSchema.optional(),
    })
    .strict(),
]);
export type TransitionFormSectionDraft = z.infer<typeof transitionFormSectionDraftSchema>;

/** `{}` → { enabled: false, sections: [] } (колонка БД с DEFAULT '{}'). */
export const transitionFormSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Пусто — заголовок окна = название кнопки. */
    title: z.string().trim().max(60).optional(),
    sections: z.array(transitionFormSectionSchema).max(12).default([]),
    /** Замки окна (#496, Р4): «закрепить после нажатия». Действуют только
     *  при `enabled` — замок часть окна (В13); выключенное окно их хранит. */
    locks: formLocksSchema.optional(),
  })
  .strict();
export type TransitionForm = z.infer<typeof transitionFormSchema>;

export const transitionFormDraftSchema = z
  .object({
    enabled: z.boolean().default(false),
    title: z.string().max(60).optional(),
    sections: z.array(transitionFormSectionDraftSchema).max(12).default([]),
    locks: formLocksSchema.optional(),
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
