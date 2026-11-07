import { z } from 'zod';

import { formulaNodeSchema } from './formula.js';

import {
  customFieldValueSchema,
  customFieldValueSchemaOf,
  CUSTOM_FIELD_LIMITS,
} from './custom-field-values.js';
import { customFieldRefSchema } from './custom-field-refs.js';

/**
 * Реестр определений атрибутов портала (#631, ADR-0037 п.2): одно
 * определение на весь портал — много мест. Название уникально глобально
 * (без учёта регистра), адресация — стабильный `id` (значения JSONB) и
 * внутренний `number` (формулы #632, людям не показывается). Привязки
 * «Где используется» — к типам процессов, типам проектов и видам папок.
 */

/** Модуль-фильтр реестра: где атрибут используется. `company` — глобальные
 *  переменные; «Реестры» добавит #636, до него не показываются (В6). */
export const customFieldModuleSchema = z.enum(['task', 'letter', 'project', 'node', 'company']);
export type CustomFieldModule = z.infer<typeof customFieldModuleSchema>;

/** Тип поля (Р1). UI показывает семейства — модификаторы типа («Многострочный»,
 *  «Несколько значений») включаются односторонне (Р3). Ссылки на записи
 *  (`task`, `letter`, `node`) — #631 Р5; «строка реестра» добавит #636. */
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
  'task',
  'letter',
  'node',
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

/** «Где используется» (Р3): привязки определения к местам. Глобальная
 *  переменная (isCompany) привязок не имеет — все списки пусты. */
export const customFieldBindingsSchema = z
  .object({
    /** Типы задач и писем (формы создания, карточки, окна переходов). */
    processTypeIds: z.array(z.uuid()).max(200),
    /** Типы проектов (форма типа проекта, диалоги проекта). */
    projectTypeIds: z.array(z.uuid()).max(200),
    /** Виды папок (форма вида, окно создания папки). */
    nodeKindIds: z.array(z.uuid()).max(200),
  })
  .strict();
export type CustomFieldBindings = z.infer<typeof customFieldBindingsSchema>;

export const EMPTY_CUSTOM_FIELD_BINDINGS: CustomFieldBindings = {
  processTypeIds: [],
  projectTypeIds: [],
  nodeKindIds: [],
};

export const customFieldDefinitionSchema = z.object({
  id: z.uuid(),
  /** Внутренний номер (Р2): выдаётся системой при создании, не переиспользуется,
   *  в интерфейсе не показывается; адрес атрибута в формулах #632. */
  number: z.number().int().min(1),
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
  /** Глобальная переменная (Р7, категория «Глобальная переменная» — как в
   *  Битриксе): значений у записей не принимает, привязок не имеет; значение
   *  одно на компанию, правит администратор из реестра атрибутов. */
  isCompany: z.boolean(),
  /** Значение глобальной переменной (грамматика типа); у обычных атрибутов —
   *  null. Изменение — событие definition_changed {fields:['companyValue']}. */
  companyValue: customFieldValueSchema.nullable(),
  /** Ссылки значения глобальной переменной (имена для показа): сервер
   *  гидрирует их глазами актёра. Поле производное — старые моки/клиенты
   *  могут его не присылать (пусто = имени нет). */
  companyRefs: z.array(customFieldRefSchema).optional(),
  bindings: customFieldBindingsSchema,
  /** Формулы типа/вида по привязкам (#632, Р6): ключ — id цели привязки
   *  (тип процесса, тип проекта, вид папки), значение — AST. Формула живёт
   *  на привязке «атрибут × место», а не на атрибуте: у одного атрибута в
   *  разных местах разные формулы. */
  bindingFormulas: z.record(z.uuid(), formulaNodeSchema).optional(),
  /** Категории процессов, к типам которых привязан атрибут (#632, Р9):
   *  решающий сигнал для колонок видов — в список задач идут task-атрибуты,
   *  в список писем — letter-атрибуты. Производное поле (сервер считает по
   *  привязкам); старые моки могут его не присылать. */
  processCategories: z.array(z.enum(['task', 'letter'])).optional(),
  sortOrder: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

/** `GET /custom-fields/definitions?module=` — массив без курсора (О9 ADR-0029,
 *  потолок портала держит размер); `module` — фильтр по привязке/категории. */
export const listCustomFieldsQuerySchema = z.object({
  module: customFieldModuleSchema.optional(),
});
export type ListCustomFieldsQuery = z.infer<typeof listCustomFieldsQuerySchema>;

/**
 * `GET /custom-fields/definitions/:id/usage` — агрегат последствий удаления
 * (окно «Что удалится», Р8): значения по видам сущностей, формы создания,
 * маршруты (окна, гейты, условия решающих), привязки, глобальное значение.
 * Удаление разрешено всегда — usage информирует, не блокирует.
 */
export const customFieldUsageSchema = z.object({
  /** Число записей со значением по видам сущностей. Контрагенты — пятый
   *  носитель (колонка `counterparties.custom_fields` живёт с #431, пути
   *  записи — Н2 CRM; миграция #631 переписывает её ключи, поэтому честный
   *  счётчик и уборка обязательны уже сейчас). */
  values: z.object({
    task: z.number().int().min(0),
    letter: z.number().int().min(0),
    project: z.number().int().min(0),
    node: z.number().int().min(0),
    counterparty: z.number().int().min(0),
  }),
  /** Формы, где атрибут стоит слотом: формы создания типов процессов
   *  (`task`/`letter`), формы типов проектов и формы видов папок.
   *  `draft` — форма создания непубликуемого черновика процесса: удаление
   *  она не блокирует, но окно последствий обязано её показать (Review
   *  Focus §9 #631). */
  forms: z.array(
    z
      .object({
        kind: z.enum(['task', 'letter', 'project_type', 'node_kind']),
        name: z.string().min(1),
        draft: z.boolean(),
      })
      .strict(),
  ),
  /** Опубликованные маршруты с `cf.<id>` в окне, гейте или условии решающего. */
  workflows: z.array(z.object({ id: z.uuid(), name: z.string().min(1) }).strict()),
  /** Места привязки (типы задач/писем, типы проектов, виды папок). */
  bindings: z.object({
    processTypes: z.array(z.object({ id: z.uuid(), name: z.string().min(1) }).strict()),
    projectTypes: z.array(z.object({ id: z.uuid(), name: z.string().min(1) }).strict()),
    nodeKinds: z.array(z.object({ id: z.uuid(), name: z.string().min(1) }).strict()),
  }),
  /** Заполнено ли глобальное значение (для isCompany). */
  companyValue: z.boolean(),
  /** Формулы (#632, F1): свои ячейки, формулы привязок типа/вида и слоты
   *  окон с формулой-подстановкой — окно удаления показывает последствия. */
  formulas: z
    .object({
      ownCells: z.number().int().min(0),
      typeDefaults: z.number().int().min(0),
      windowSlots: z.number().int().min(0),
    })
    .strict()
    .optional(),
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
    type: customFieldTypeSchema,
    name: z.string().trim().min(1).max(60),
    hint: z.string().trim().max(300).optional(),
    settings: customFieldSettingsSchema.default({}),
    defaultValue: customFieldDefaultSchema.nullable().optional(),
    reportIndexed: z.boolean().default(false),
    isCompany: z.boolean().default(false),
    /** Привязки сразу (диалог одношаговый): живые цели своих видов
     *  (проверяет сервер — 422 CUSTOM_FIELD_BINDING_INVALID). Глобальной
     *  переменной привязки запрещены — доменная 422 на сервере (не 400
     *  схемы: это семантика, а не форма запроса). */
    bindings: customFieldBindingsSchema.optional(),
    bindingFormulas: z.record(z.uuid(), formulaNodeSchema).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    refineShape(body, ctx);
  });
export type CreateCustomFieldBody = z.infer<typeof createCustomFieldBodySchema>;

export const updateCustomFieldBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    hint: z.string().trim().max(300).nullable().optional(),
    type: customFieldTypeSchema.optional(),
    settings: customFieldSettingsPatchSchema.optional(),
    defaultValue: customFieldDefaultSchema.nullable().optional(),
    reportIndexed: z.boolean().optional(),
    /** Полный набор привязок (замена целиком); точечные привязки —
     *  PUT/DELETE .../bindings/:kind/:targetId. */
    bindings: customFieldBindingsSchema.optional(),
    bindingFormulas: z.record(z.uuid(), formulaNodeSchema).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type UpdateCustomFieldBody = z.infer<typeof updateCustomFieldBodySchema>;

/** Порядок атрибутов портала (реестр, карточки, фильтры, окна): ids = ровно
 *  все атрибуты портала (продуктового лимита нет, В7 — потолок-страховка). */
export const reorderCustomFieldsBodySchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(CUSTOM_FIELD_LIMITS.portal),
  })
  .strict();
export type ReorderCustomFieldsBody = z.infer<typeof reorderCustomFieldsBodySchema>;

/** Вид места привязки в пути API (`PUT/DELETE .../bindings/:kind/:targetId`). */
export const customFieldBindingKindSchema = z.enum(['process-type', 'project-type', 'node-kind']);
export type CustomFieldBindingKind = z.infer<typeof customFieldBindingKindSchema>;

/** `PUT /custom-fields/definitions/:id/company-value` — значение глобальной
 *  переменной (Р7): грамматика типа, null — очистить (не задано); для
 *  не-глобального атрибута — 422. Идемпотентно (Idempotency-Key). */
export const customFieldCompanyValueBodySchema = z
  .object({ value: customFieldValueSchema.nullable() })
  .strict();
export type CustomFieldCompanyValueBody = z.infer<typeof customFieldCompanyValueBodySchema>;
