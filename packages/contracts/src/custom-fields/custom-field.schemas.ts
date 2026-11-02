import { z } from 'zod';

import {
  customFieldValueSchema,
  customFieldValueSchemaOf,
  CUSTOM_FIELD_LIMITS,
} from './custom-field-values.js';
import { customFieldRefSchema } from './custom-field-refs.js';

/**
 * Реестр определений кастомных полей (#431, ADR-0029): область (задача,
 * письмо, проект, контрагент), тип, настройки типа, умолчание. Значения
 * живут в JSONB сущности по id определения; `code` у поля нет (Р10):
 * переименование безопасно, ключ — id.
 */

/** Область применения. `node` («Папки») активирована #556: атрибуты видов
 *  папок структуры проекта (ADR-0030 «Дополнение (02.11)»). */
export const customFieldScopeSchema = z.enum(['task', 'letter', 'project', 'node', 'counterparty']);
export type CustomFieldScope = z.infer<typeof customFieldScopeSchema>;

/** Тип поля (Р1). UI показывает 13 семейств — модификаторы типа («Многострочный»,
 *  «Несколько значений») включаются односторонне (Р3). */
export const customFieldTypeSchema = z.enum([
  'text',
  'long_text',
  'number',
  'money',
  'date',
  'datetime',
  'duration',
  'bool',
  'enum',
  'multienum',
  'user',
  'users',
  'department',
  'project',
  'counterparty',
  'link',
]);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

/** Настройки типа: точность числа, валюта денег, справочник списка. */
export const customFieldSettingsSchema = z
  .object({
    precision: z.number().int().min(0).max(6).optional(),
    currencyId: z.uuid().nullable().optional(),
    dictionaryId: z.uuid().optional(),
  })
  .strict();
export type CustomFieldSettings = z.infer<typeof customFieldSettingsSchema>;

/** Правка настроек: справочник списка после создания неизменен (Р3). */
export const customFieldSettingsPatchSchema = z
  .object({
    precision: z.number().int().min(0).max(6).optional(),
    currencyId: z.uuid().nullable().optional(),
  })
  .strict();
export type CustomFieldSettingsPatch = z.infer<typeof customFieldSettingsPatchSchema>;

/** Умолчание: статическое значение или «подразделение автора» (снимок, Р5). */
export const customFieldDefaultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static'), value: customFieldValueSchema }).strict(),
  z.object({ kind: z.literal('author_department') }).strict(),
]);
export type CustomFieldDefault = z.infer<typeof customFieldDefaultSchema>;

/** Справочник списка в DTO определения (подпись вариантов в редакторе). */
export const customFieldDictionaryRefSchema = z
  .object({
    id: z.uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
    isSystem: z.boolean(),
  })
  .strict();
export type CustomFieldDictionaryRef = z.infer<typeof customFieldDictionaryRefSchema>;

export const customFieldDefinitionSchema = z.object({
  id: z.uuid(),
  scope: customFieldScopeSchema,
  type: customFieldTypeSchema,
  name: z.string().min(1).max(60),
  hint: z.string().max(300).nullable(),
  settings: customFieldSettingsSchema,
  dictionary: customFieldDictionaryRefSchema.nullable(),
  defaultValue: customFieldDefaultSchema.nullable(),
  /** Ссылки статического умолчания (сотрудник, вариант, валюта…): имена для
   *  колонки «По умолчанию» и окна атрибута, как `customFieldRefs` детали (Р6). */
  defaultRefs: z.array(customFieldRefSchema),
  /** Флаг «индексировать для отчётов» (Р9): материализация — по триггеру (Н4). */
  reportIndexed: z.boolean(),
  /** Скрытый (служебный) атрибут: значения живут и доступны процессам,
   *  автоматизации и отчётам, но в карточках, фильтрах и окнах переходов
   *  его не видит никто (вердикт владельца 25.10.2026 — замена архива). */
  hidden: z.boolean(),
  /** Типы процессов, которым принадлежит атрибут (#432, В2): карточка,
   *  форма создания, окна и условия показывают только свои атрибуты.
   *  Пусто — атрибут нигде не показывается. У проектов и контрагентов
   *  типов процессов нет: там список пуст и не настраивается. */
  typeIds: z.array(z.uuid()).max(50),
  sortOrder: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

/** `GET /custom-fields/definitions` — массив без курсора (О9: ≤ 100 на область). */
export const listCustomFieldsQuerySchema = z.object({
  scope: customFieldScopeSchema.optional(),
});
export type ListCustomFieldsQuery = z.infer<typeof listCustomFieldsQuerySchema>;

/**
 * `GET /custom-fields/definitions/:id/usage` — где используется атрибут
 * (окно удаления): число сущностей со значением и маршруты процессов,
 * ссылающиеся на `cf.<id>` в окне перехода или условии опубликованной
 * версии (`id` — маршрут, `name` — название его типа процесса). Непустой
 * `workflows` блокирует удаление (409 CUSTOM_FIELD_IN_USE с тем же списком
 * в details); `DELETE /custom-fields/definitions/:id` → 204.
 */
export const customFieldUsageSchema = z.object({
  valueCount: z.number().int().min(0),
  workflows: z.array(z.object({ id: z.uuid(), name: z.string().min(1) })),
  /** Виды папок, в форме которых стоит атрибут (область `node`; у других
   *  областей — пусто). Архивные виды тоже перечисляются; удаление
   *  использование видами НЕ блокирует — значения стираются (Р11). */
  nodeKinds: z.array(z.object({ id: z.uuid(), name: z.string().min(1) })),
});
export type CustomFieldUsage = z.infer<typeof customFieldUsageSchema>;

/** Проблема формы определения: код + поле (тексты — i18n веба/сервера). */
export interface CustomFieldShapeIssue {
  code:
    | 'settings_not_allowed'
    | 'precision_not_allowed'
    | 'currency_required'
    | 'dictionary_required'
    | 'default_not_allowed'
    | 'default_invalid';
  path: 'settings' | 'defaultValue';
  message: string;
}

/**
 * Форма определения: какие настройки допустимы типу и годится ли умолчание.
 * Одна функция для superRefine тел API и подсказок формы веба (правило
 * «общая грамматика» — как `checkWorkflowDocument`).
 */
export function checkDefinitionShape(
  type: CustomFieldType,
  settings: CustomFieldSettings,
  defaultValue: CustomFieldDefault | null,
): CustomFieldShapeIssue[] {
  const issues: CustomFieldShapeIssue[] = [];
  const has = {
    precision: settings.precision !== undefined,
    currency: settings.currencyId !== undefined && settings.currencyId !== null,
    dictionary: settings.dictionaryId !== undefined,
  };

  if (has.precision && type !== 'number') {
    issues.push({
      code: 'precision_not_allowed',
      path: 'settings',
      message: 'precision is only allowed for number fields',
    });
  }
  if (has.currency && type !== 'money') {
    issues.push({
      code: 'settings_not_allowed',
      path: 'settings',
      message: 'currency is only allowed for money fields',
    });
  }
  if (has.dictionary && type !== 'enum' && type !== 'multienum') {
    issues.push({
      code: 'settings_not_allowed',
      path: 'settings',
      message: 'dictionary is only allowed for list fields',
    });
  }
  if (type === 'money' && !has.currency) {
    issues.push({
      code: 'currency_required',
      path: 'settings',
      message: 'money field requires currency',
    });
  }
  if ((type === 'enum' || type === 'multienum') && !has.dictionary) {
    issues.push({
      code: 'dictionary_required',
      path: 'settings',
      message: 'list field requires dictionary',
    });
  }

  if (defaultValue?.kind === 'author_department' && type !== 'department') {
    issues.push({
      code: 'default_not_allowed',
      path: 'defaultValue',
      message: 'author department default is only allowed for department fields',
    });
  }
  if (defaultValue?.kind === 'static') {
    const parsed = customFieldValueSchemaOf({ type, settings }).safeParse(defaultValue.value);
    if (!parsed.success) {
      issues.push({
        code: 'default_invalid',
        path: 'defaultValue',
        message: 'default value does not match field type',
      });
    }
  }
  return issues;
}

function refineShape(
  body: {
    type: CustomFieldType;
    settings?: CustomFieldSettings;
    defaultValue?: CustomFieldDefault | null;
  },
  ctx: z.RefinementCtx,
): void {
  for (const issue of checkDefinitionShape(
    body.type,
    body.settings ?? {},
    body.defaultValue ?? null,
  )) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
}

export const createCustomFieldBodySchema = z
  .object({
    scope: customFieldScopeSchema,
    type: customFieldTypeSchema,
    name: z.string().trim().min(1).max(60),
    hint: z.string().trim().max(300).optional(),
    settings: customFieldSettingsSchema.default({}),
    defaultValue: customFieldDefaultSchema.nullable().optional(),
    reportIndexed: z.boolean().default(false),
    hidden: z.boolean().default(false),
    /** Типы процессов, которым принадлежит атрибут (#432): живые типы
     *  своей категории (проверяет сервер — 422 CUSTOM_FIELD_BINDING_INVALID). */
    typeIds: z.array(z.uuid()).max(50).optional(),
  })
  .strict()
  .superRefine(refineShape);
export type CreateCustomFieldBody = z.infer<typeof createCustomFieldBodySchema>;

export const updateCustomFieldBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    hint: z.string().trim().max(300).nullable().optional(),
    type: customFieldTypeSchema.optional(),
    settings: customFieldSettingsPatchSchema.optional(),
    defaultValue: customFieldDefaultSchema.nullable().optional(),
    reportIndexed: z.boolean().optional(),
    hidden: z.boolean().optional(),
    /** Полный список типов (замена целиком); точечные привязки —
     *  PUT/DELETE .../types/:typeId. */
    typeIds: z.array(z.uuid()).max(50).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type UpdateCustomFieldBody = z.infer<typeof updateCustomFieldBodySchema>;

/** Порядок атрибутов области (карточка, фильтры, окна): ids = ровно все
 *  атрибуты области. */
export const reorderCustomFieldsBodySchema = z
  .object({
    scope: customFieldScopeSchema,
    ids: z.array(z.uuid()).min(1).max(CUSTOM_FIELD_LIMITS.perScope),
  })
  .strict();
export type ReorderCustomFieldsBody = z.infer<typeof reorderCustomFieldsBodySchema>;

/** Сколько атрибутов осталось до лимита области (подсказка формы). */
export function customFieldLimitLeft(activeInScope: number): number {
  return Math.max(0, CUSTOM_FIELD_LIMITS.perScope - activeInScope);
}
