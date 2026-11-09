import { z } from 'zod';

import {
  isCustomFieldValueFilled,
  type CustomFieldValues,
} from '../custom-fields/custom-field-values.js';
import { customFieldKey } from '../custom-fields/custom-field-key.js';
import {
  fieldFormSlotSchema,
  fieldFormStateSchema,
  formSlots,
  isFieldFormSlot,
} from '../custom-fields/field-form.schemas.js';
import { attributeFormSchema } from '../forms/attribute-form.js';
import { projectColorSchema } from './project.schemas.js';

/**
 * Вид папки как настраиваемый тип (#556, ADR-0030 «Дополнение (02.11)»;
 * ревизия #631): конфигурация вида — форма создания (атрибуты в состояниях
 * «скрыто / по желанию / обязательно») и закрытый список возможностей.
 * Форма вида задаёт СОСТОЯНИЯ атрибутов; сама привязка «атрибут × вид»
 * живёт в реестре атрибутов («Где используется», Р3). Бывший системный
 * слот `code` заменён посевным атрибутом «Код» (system-fields). Значения
 * живут в JSONB папки по id определения, проверка — порт
 * `CUSTOM_FIELD_REGISTRY` со скоупингом target.
 *
 * Схема закрытая: битый раздел при чтении заменяется умолчанием
 * (`normalizeNodeKindConfig`), запись — целыми разделами, сохраняется сразу.
 */

/** Значки видов папок — закрытый список ключей (I15); веб-реестр
 *  `node-kind-icon.tsx` отображает ключ на lucide-иконку (рассинхрон ключа и
 *  реестра = ошибка типов, паттерн process-type-icon.tsx). `fileText` —
 *  документ с изменениями (#557, посев «Комплекта»). */
export const nodeKindIconSchema = z.enum([
  'folder',
  'folderTree',
  'layers',
  'building',
  'building2',
  'landmark',
  'boxes',
  'box',
  'listTree',
  'flag',
  'milestone',
  'factory',
  'route',
  'squareStack',
  'fileText',
]);
export type NodeKindIcon = z.infer<typeof nodeKindIconSchema>;

/** Лимиты конфигурации вида. */
export const NODE_KIND_LIMITS = {
  /** Атрибутов в форме вида (слоты всех состояний). */
  fields: 30,
} as const;

/** Возможности вида — закрытый список (порядок = порядок показа). Поведение
 *  включают только они: кода под конкретный вид нет. */
export const nodeKindCapabilitySchema = z.enum(['document_changes', 'pulse_row', 'schema_row']);
export type NodeKindCapability = z.infer<typeof nodeKindCapabilitySchema>;

/** Порядок переключателей и чипов возможностей. */
export const NODE_KIND_CAPABILITIES = nodeKindCapabilitySchema.options;

/** Состояние поля формы: «скрыто» — не спрашивается при создании, но видно
 *  и правится в свойствах; «по желанию» и «обязательно» — в окне создания. */
export const nodeKindFieldStateSchema = fieldFormStateSchema;
export type NodeKindFieldState = z.infer<typeof nodeKindFieldStateSchema>;

export const nodeKindFormFieldSchema = fieldFormSlotSchema;
export type NodeKindFormField = z.infer<typeof nodeKindFormFieldSchema>;

/** Форма вида (#496, Р3): слоты атрибутов с раскладкой и оформление —
 *  общая форма атрибутов (≤ 30 слотов, ≤ 10 оформления, без дублей).
 *  Слоты читаются через `formSlots`. */
export const nodeKindFormSchema = attributeFormSchema;
export type NodeKindForm = z.infer<typeof nodeKindFormSchema>;

/** Возможности: без дублей, ≤ 3. Порядок нормализуется к порядку enum. */
export const nodeKindCapabilitiesSchema = z
  .array(nodeKindCapabilitySchema)
  .max(NODE_KIND_CAPABILITIES.length)
  .refine((values) => new Set(values).size === values.length, { message: 'duplicate capability' });
export type NodeKindCapabilities = z.infer<typeof nodeKindCapabilitiesSchema>;

export const nodeKindConfigSchema = z
  .object({
    form: nodeKindFormSchema,
    capabilities: nodeKindCapabilitiesSchema,
  })
  .strict();
export type NodeKindConfig = z.infer<typeof nodeKindConfigSchema>;

/** Умолчание: атрибутов нет, возможностей нет. */
export const DEFAULT_NODE_KIND_FORM: NodeKindForm = { fields: [] };

export const DEFAULT_NODE_KIND_CONFIG: NodeKindConfig = {
  form: DEFAULT_NODE_KIND_FORM,
  capabilities: [],
};

function parseOr<T>(schema: z.ZodType<T>, raw: unknown, fallback: T): T {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

/** Возможности в порядке enum без дублей (нормализация записи и чтения). */
export function normalizeNodeKindCapabilities(raw: unknown): NodeKindCapability[] {
  if (!Array.isArray(raw)) return [];
  const present = new Set(raw.filter((value): value is string => typeof value === 'string'));
  return NODE_KIND_CAPABILITIES.filter((capability) => present.has(capability));
}

/** Толерантное чтение `node_kinds.config` (`{}` → умолчания, битый раздел →
 *  умолчание раздела, остальные разделы не страдают, лишние ключи
 *  отбрасываются). */
export function normalizeNodeKindConfig(raw: unknown): NodeKindConfig {
  if (raw === null || typeof raw !== 'object') return DEFAULT_NODE_KIND_CONFIG;
  const source = raw as Record<string, unknown>;
  return {
    form: parseOr(nodeKindFormSchema, source.form, DEFAULT_NODE_KIND_CONFIG.form),
    capabilities: normalizeNodeKindCapabilities(source.capabilities),
  };
}

/** Вид папки — DTO плоский: конфигурация развёрнута в `form` и `capabilities`
 *  (веб не знает про JSONB). Справочник «Автоматизации»; удаление = архивация
 *  (папки архивного вида создавать нельзя, существующие живут). */
export const nodeKindSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  icon: nodeKindIconSchema,
  color: projectColorSchema,
  archivedAt: z.iso.datetime().nullable(),
  form: nodeKindFormSchema,
  capabilities: nodeKindCapabilitiesSchema,
});
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const nodeKindListSchema = z.array(nodeKindSchema);
export type NodeKindList = z.infer<typeof nodeKindListSchema>;

/** Название вида уникально без учёта регистра и пробелов (lower(btrim(name))). */
export const nodeKindCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: nodeKindIconSchema,
  color: projectColorSchema,
});
export type NodeKindCreateBody = z.infer<typeof nodeKindCreateBodySchema>;

/** Правка: разделы `form`/`capabilities` заменяются ЦЕЛИКОМ; отсутствующий
 *  раздел не трогается. Без `.default()` (gotcha Zod 4 `.partial()`:
 *  умолчания подставляются в чужой раздел). */
export const nodeKindUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: nodeKindIconSchema.optional(),
    color: projectColorSchema.optional(),
    form: nodeKindFormSchema.optional(),
    capabilities: nodeKindCapabilitiesSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type NodeKindUpdateBody = z.infer<typeof nodeKindUpdateBodySchema>;

/** Терпимое чтение DTO со старого API (:5173 без бэкенд-пакета #556):
 *  `form`/`capabilities` приходят позже — веб живёт на умолчаниях. */
export function nodeKindFormOf(kind: { form?: unknown }): NodeKindForm {
  return parseOr(nodeKindFormSchema, kind.form, DEFAULT_NODE_KIND_FORM);
}

export function nodeKindCapabilitiesOf(kind: { capabilities?: unknown }): NodeKindCapability[] {
  return normalizeNodeKindCapabilities(kind.capabilities);
}

/** Есть ли у вида возможность (потребители #557/#469/#38 читают только это). */
export function nodeKindHas(
  kind: { capabilities?: readonly string[] | unknown },
  capability: NodeKindCapability,
): boolean {
  const values = kind.capabilities;
  return Array.isArray(values) && values.includes(capability);
}

/**
 * Эффективная форма вида: слоты без неизвестных id (определение удалено).
 * Без списка определений (моки, предпросмотр) форма берётся как есть.
 * Глобального скрытия больше нет — видимость регулирует слот (О2 #631).
 */
export function effectiveNodeForm(
  kind: { form?: unknown },
  definitions?: readonly { id: string }[],
): NodeKindForm {
  const form = nodeKindFormOf(kind);
  if (!definitions) return form;
  const known = new Set(definitions.map((definition) => definition.id));
  // Оформление переживает снятие атрибута (#496, I-F1): фильтруются только слоты.
  return {
    fields: form.fields.filter(
      (element) => !isFieldFormSlot(element) || known.has(element.fieldId),
    ),
  };
}

/**
 * Значения формы вида — единственный способ читать значения папки для формы
 * (Р5): все состояния, включая «скрыто» (значения, скрытые сменой вида,
 * не теряются). Потребители (#557/#469/#38) ОБЯЗАНЫ брать значения через
 * этого помощника, а не сырым `customFields`.
 */
export function nodeFormValues(
  values: CustomFieldValues | undefined,
  kind: { form?: unknown },
  definitions?: readonly { id: string }[],
): CustomFieldValues {
  if (!values) return {};
  const form = effectiveNodeForm(kind, definitions);
  const out: CustomFieldValues = {};
  for (const slot of formSlots(form)) {
    const value = values[slot.fieldId];
    if (value !== undefined) out[slot.fieldId] = value;
  }
  return out;
}

/** Ключ поля формы: `cf.<id>` — атрибут (общий ключ окна/гейта, канон #431). */
export type NodeFormKey = `cf.${string}`;

export function nodeFormKey(fieldId: string): NodeFormKey {
  return customFieldKey(fieldId);
}

/** Обязательные слоты формы (состояние «обязательно»). */
export function requiredNodeFields(form: NodeKindForm): NodeFormKey[] {
  return formSlots(form)
    .filter((slot) => slot.state === 'required')
    .map((slot) => nodeFormKey(slot.fieldId));
}

/**
 * Чего не хватает для формы (обязательные слоты): проверка ПОСЛЕ умолчаний
 * атрибутов. Отказ — 422 `PROJECT_NODE_FIELDS_REQUIRED`.
 */
export function missingNodeFields(
  form: NodeKindForm,
  input: { customFields?: CustomFieldValues },
): NodeFormKey[] {
  return requiredNodeFields(form).filter(
    (key) => !isCustomFieldValueFilled(input.customFields?.[key.slice('cf.'.length)]),
  );
}

/** Ключи обязательных полей, которые патч очищает (`null`/пусто) — 422
 *  `PROJECT_NODE_FIELDS_REQUIRED { reason: 'clear' }`. `values` — новые
 *  значения по ключам формы; отсутствующий ключ не трогается. */
export function clearedNodeFields(
  requiredKeys: readonly NodeFormKey[],
  values: Readonly<Record<string, unknown>>,
): NodeFormKey[] {
  return requiredKeys.filter((key) => key in values && !isCustomFieldValueFilled(values[key]));
}

/** Виды папок, допустимые типу проекта (#556): `null` — все, массив — только
 *  перечисленные (порядок справочника). Одна функция для панели типа, окна
 *  создания папки и серверной проверки. */
export function allowedNodeKinds(
  kindIds: readonly string[] | null,
  kinds: readonly NodeKind[],
): NodeKind[] {
  return kindIds === null ? [...kinds] : kinds.filter((kind) => kindIds.includes(kind.id));
}

/** Разрешён ли вид папки типу проекта (сервер — 422 KIND_NOT_ALLOWED). */
export function kindAllowedByType(kindIds: readonly string[] | null, kindId: string): boolean {
  return kindIds === null || kindIds.includes(kindId);
}
