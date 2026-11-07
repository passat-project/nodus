import { z } from 'zod';

import type { CustomFieldDefinition, CustomFieldType } from './custom-field.schemas.js';

/**
 * Грамматика значений кастомных полей (#431, ADR-0029) — ОДНА для веба,
 * моков и сервера (исключение «общая грамматика» из patterns.md): веб строит
 * подсказки редакторов, MSW даёт те же отказы, сервер проверяет на границе.
 * Значения живут в JSONB по id определения (`cf.<uuid>` в окнах и гейтах);
 * пустое не хранится — `null` в правке удаляет ключ.
 */

/** Деньги: сумма + валюта (элемент системного справочника `currency`). */
export const moneyValueSchema = z
  .object({
    amount: z.number().finite().min(-1e12).max(1e12),
    currencyId: z.uuid(),
  })
  .strict();
export type MoneyValue = z.infer<typeof moneyValueSchema>;

/** Общая форма значения (DTO, граница HTTP): тип поля знает валидатор. */
export const customFieldValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  moneyValueSchema,
]);
export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

/** Значения сущности по id определения (JSONB-колонка). */
export const customFieldValuesSchema = z.record(z.uuid(), customFieldValueSchema);
export type CustomFieldValues = z.infer<typeof customFieldValuesSchema>;

/** Ввод значений на границе HTTP: общая форма, ≤ 50 ключей (создание, окно). */
export const customFieldValuesInputSchema = z
  .record(z.uuid(), customFieldValueSchema)
  .refine((v) => Object.keys(v).length <= 50, { message: 'more than 50 fields' });

/** Патч значений: `null` — очистить поле (PATCH задачи, окно перехода). */
export const customFieldValuesPatchSchema = z
  .record(z.uuid(), customFieldValueSchema.nullable())
  .refine((v) => Object.keys(v).length <= 50, { message: 'more than 50 fields' });

/** Лимиты модуля (значения — контракт, UI берёт подсказки отсюда). */
export const CUSTOM_FIELD_LIMITS = {
  /** Технический потолок атрибутов на портал (страховка от зацикленного
   *  скрипта: реестр грузится массивом целиком); продуктового лимита нет
   *  (В7) — в UI не светится. */
  portal: 1000,
  /** Элементов «Списка (несколько)» и «Сотрудников (несколько)». */
  multi: 50,
  /** Текст (одна строка). */
  text: 500,
  /** Многострочный текст. */
  longText: 5000,
  /** Ссылка/путь. */
  link: 2000,
  /** Модуль суммы (деньги и числа). */
  amount: 1e12,
  /** Продолжительность, минуты. */
  duration: 100_000,
  /** Текст значения в событии (long_text обрезается). */
  eventText: 500,
  /** Полей в одном разделе окна перехода. */
  windowFields: 12,
  /** Ключей в гейте «Заполнены поля». */
  gateFields: 20,
  /** Изменений в событии `task.updated`. */
  changes: 50,
  /** Формулы (#632): глубина AST. */
  formulaDepth: 12,
  /** Формулы (#632): узлов в формуле. */
  formulaNodes: 60,
  /** Формулы (#632): источников в формуле. */
  formulaSources: 8,
  /** Формулы (#632): знаков в строковом литерале. */
  formulaText: 500,
  /** Формулы (#632): записей в выборке агрегата. */
  formulaSelection: 500,
  /** Формулы (#632): глубина волны пересчёта (защита от живого цикла). */
  formulaCascadeDepth: 8,
} as const;

/** Сколько знаков после запятой у числа (у чисел с плавающей точкой —
 *  с допуском на двоичное представление). */
function hasPrecision(value: number, precision: number): boolean {
  const factor = 10 ** precision;
  const scaled = value * factor;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, Math.abs(scaled));
}

const amountSchema = (precision: number) =>
  z
    .number()
    .finite()
    .min(-CUSTOM_FIELD_LIMITS.amount)
    .max(CUSTOM_FIELD_LIMITS.amount)
    .refine((v) => hasPrecision(v, precision), { message: 'too many decimal places' });

const linkSchema = z
  .string()
  .trim()
  .min(1)
  .max(CUSTOM_FIELD_LIMITS.link)
  .refine((v) => !/\p{Cc}/u.test(v), { message: 'control characters' })
  .refine((v) => /^https?:\/\/\S+$/i.test(v) || /^\\\\[^\\/\s]+\\[^\\/\s]+(\\[^\\]*)*$/.test(v), {
    message: 'link must be http(s) url or unc path',
  });

const multiSchema = z
  .array(z.uuid())
  .min(1)
  .max(CUSTOM_FIELD_LIMITS.multi)
  .refine((v) => new Set(v).size === v.length, { message: 'duplicate items' });

/**
 * Схема значения конкретного определения: тип + настройки. Используется
 * сервером (проверка на границе), моками и веб-редакторами (подсказки).
 */
export function customFieldValueSchemaOf(
  definition: Pick<CustomFieldDefinition, 'type' | 'settings'>,
): z.ZodType<CustomFieldValue> {
  switch (definition.type) {
    case 'text':
      return z
        .string()
        .trim()
        .min(1)
        .max(CUSTOM_FIELD_LIMITS.text)
        .refine((v) => !/[\r\n]/.test(v), { message: 'single line' });
    case 'long_text':
      return z.string().trim().min(1).max(CUSTOM_FIELD_LIMITS.longText);
    case 'number':
      return amountSchema(definition.settings.precision ?? 0);
    case 'money':
      return moneyValueSchema.refine((v) => hasPrecision(v.amount, 2), {
        message: 'too many decimal places',
      });
    case 'date':
      return z.iso.date();
    case 'datetime':
      return z.iso.datetime();
    case 'duration':
      return z.number().int().min(1).max(CUSTOM_FIELD_LIMITS.duration);
    case 'bool':
      return z.literal(true);
    case 'enum':
    case 'user':
    case 'department':
    case 'project':
    case 'counterparty':
    case 'task':
    case 'letter':
    case 'node':
      return z.uuid();
    case 'multienum':
    case 'users':
      return multiSchema;
    case 'link':
      return linkSchema;
    case 'counter':
      // Выданный номер — строка («Вх-2026/118», «Изм. 3»); пишет только
      // движок (#630, Р10), ручной PATCH отклоняет сервер (422) — грамматика
      // нужна чтению значений и фильтру «содержит».
      return z.string().trim().min(1).max(CUSTOM_FIELD_LIMITS.text);
  }
}

/** Тип значения, который читается как массив (Р3: скаляр → массив). */
function readsAsArray(type: CustomFieldType): boolean {
  return type === 'multienum' || type === 'users';
}

/**
 * Толерантное чтение (Р3/ADR-0029): несовместимое хранимое значение — не
 * ошибка экрана, а «не задано» (undefined). Расширяющие типы читают скаляр
 * как массив (enum → multienum, user → users).
 */
export function readCustomFieldValue(
  definition: Pick<CustomFieldDefinition, 'type' | 'settings'>,
  raw: unknown,
): CustomFieldValue | undefined {
  if (raw === null || raw === undefined) return undefined;
  const parsed = customFieldValueSchemaOf(definition).safeParse(raw);
  if (parsed.success) return parsed.data;
  if (readsAsArray(definition.type) && z.uuid().safeParse(raw).success) return [raw as string];
  return undefined;
}

/** «Пустой» маркер из дефисов/пробелов (`—`, `–`, `−`, `‐`, `‑` и комбинации):
 *  легаси-пустота в строковых значениях. Для формул, фильтров и «заполнено»
 *  это пусто (#632); при записи реестр нормализует маркер в null — новые
 *  дефисы в БД не попадают. Один предикат на все слои (движок/API/веб). */
const EMPTY_DASH_MARKER = /^[\s\u2010-\u2015\u2212-]+$/;

export function isDashOnlyMarker(value: unknown): boolean {
  return typeof value === 'string' && EMPTY_DASH_MARKER.test(value);
}

/** «Заполнено»: непустая строка/массив, число (в т.ч. 0), деньги, `true`;
 *  дефис-маркер — не заполнено (пустое значение не считается значением). */
export function isCustomFieldValueFilled(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'string') return raw.trim().length > 0 && !isDashOnlyMarker(raw);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw);
  if (Array.isArray(raw)) return raw.length > 0;
  if (typeof raw === 'object') return moneyValueSchema.safeParse(raw).success;
  return false;
}

/**
 * Совпадают ли значения атрибута (Р5 #632): повторная запись того же
 * значения — не «вписал руками», формулу она не снимает. `null` и
 * `undefined` — одно и то же «пусто»; массивы сравниваются поэлементно,
 * деньги — по сумме и валюте (порядок ключей JSON не важен).
 */
export function sameCustomFieldValue(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (right === null || right === undefined) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
  }
  if (typeof left === 'object' || typeof right === 'object') {
    if (typeof left !== 'object' || typeof right !== 'object') return false;
    const a = left as Partial<MoneyValue>;
    const b = right as Partial<MoneyValue>;
    return a.amount === b.amount && a.currencyId === b.currencyId;
  }
  return left === right;
}

/** Белый список смены типа (Р3): только расширяющая, без сканов данных. */
const TYPE_WIDENING: Partial<Record<CustomFieldType, CustomFieldType>> = {
  text: 'long_text',
  enum: 'multienum',
  user: 'users',
};

export function isCompatibleTypeChange(from: CustomFieldType, to: CustomFieldType): boolean {
  return from === to || TYPE_WIDENING[from] === to;
}

/** Вид ссылки-значения: URL открывается, путь копируется (Р11). */
export function linkKindOf(value: unknown): 'url' | 'path' | null {
  if (typeof value !== 'string') return null;
  if (/^https?:\/\//i.test(value)) return 'url';
  if (value.startsWith('\\\\')) return 'path';
  return null;
}

/** Изменение значения поля для события `task.updated` (Р12). */
export const customFieldChangeSchema = z
  .object({
    fieldId: z.uuid(),
    from: customFieldValueSchema.nullable(),
    to: customFieldValueSchema.nullable(),
  })
  .strict();

export interface CustomFieldChange {
  fieldId: string;
  from: CustomFieldValue | null;
  to: CustomFieldValue | null;
}

/**
 * Патч значений по определениям области: `null` — очистить; чужой ключ,
 * несовместимое значение и больше лимита ключей — ошибка (strict).
 */
export function buildValuesPatchSchema(
  definitions: readonly CustomFieldDefinition[],
  opts: { max?: number } = {},
): z.ZodType<Record<string, CustomFieldValue | null>> {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const max = opts.max ?? 50;
  return z.record(z.uuid(), customFieldValueSchema.nullable()).superRefine((values, ctx) => {
    const keys = Object.keys(values);
    if (keys.length > max) {
      ctx.addIssue({ code: 'custom', message: `more than ${max} fields` });
      return;
    }
    for (const [fieldId, value] of Object.entries(values)) {
      const definition = byId.get(fieldId);
      if (!definition) {
        ctx.addIssue({ code: 'custom', path: [fieldId], message: 'unknown field' });
        continue;
      }
      if (value === null) continue;
      const parsed = customFieldValueSchemaOf(definition).safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', path: [fieldId], message: 'invalid value' });
      }
    }
  });
}

/** Ввод значений при создании сущности (≤ 50 ключей, без null). */
export function buildValuesInputSchema(
  definitions: readonly CustomFieldDefinition[],
  opts: { max?: number } = {},
): z.ZodType<Record<string, CustomFieldValue>> {
  const patch = buildValuesPatchSchema(definitions, opts);
  return patch.refine((values) => Object.values(values).every((v) => v !== null), {
    message: 'null is not allowed on create',
  }) as z.ZodType<Record<string, CustomFieldValue>>;
}
