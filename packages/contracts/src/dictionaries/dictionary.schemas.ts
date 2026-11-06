import { z } from 'zod';

import { cursorQuerySchema } from '../pagination/paginated.schema.js';
import { stageColorSchema } from '../workflows/workflow-primitives.schemas.js';

/**
 * Справочники (dictionaries, ядро, I15): бизнес-списки живут данными, а не
 * кодом. Справочник адресуется стабильным `code` (kebab-case), элемент —
 * по ID (переименование элемента не трогает ссылающиеся сущности).
 * Удаления нет — только архивация (`isActive: false`); архивный элемент
 * остаётся читаемым для старых записей, но не предлагается в новых.
 */

/** Код справочника: стабильный машинный ключ (`document-kind`). */
export const dictionaryCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);

export type DictionaryCode = z.infer<typeof dictionaryCodeSchema>;

/** Системные справочники — их существование гарантирует миграция,
 *  потребители адресуют их этими кодами (элементы — данные администратора). */
export const SystemDictionary = {
  /** Вид документа корреспонденции (Инструкция РБ по делопроизводству). */
  DOCUMENT_KIND: 'document-kind',
  /** Валюты денежных полей (#431, Р10): BYN первым, затем RUB/USD/EUR/CNY. */
  CURRENCY: 'currency',
  /** Способы поступления письма (#55, Р14): поле регистрации. */
  RECEIPT_METHOD: 'receipt-method',
} as const;

export type SystemDictionary = (typeof SystemDictionary)[keyof typeof SystemDictionary];

/** Коды элементов справочника способов поступления (#55, Р14): по коду
 *  подставляется умолчание формы — ручное создание (бумага) → `post`,
 *  почта (#56) → `email`. Названия — данные справочника. */
export const RECEIPT_METHOD_CODES = {
  email: 'email',
  post: 'post',
  courier: 'courier',
  smdo: 'smdo',
} as const;

export type ReceiptMethodCode = (typeof RECEIPT_METHOD_CODES)[keyof typeof RECEIPT_METHOD_CODES];

export const dictionarySchema = z.object({
  id: z.uuid(),
  code: dictionaryCodeSchema,
  name: z.string().min(1),
  /** Элементы образуют дерево (`parentId`); плоский справочник — false. */
  hierarchical: z.boolean(),
  /** Создан миграцией и нужен коду-потребителю: не архивируется, `code` неизменен. */
  isSystem: z.boolean(),
});

export type Dictionary = z.infer<typeof dictionarySchema>;

export const dictionaryItemSchema = z.object({
  id: z.uuid(),
  dictionaryId: z.uuid(),
  /** Родитель в иерархическом справочнике; у плоского — всегда null. */
  parentId: z.uuid().nullable(),
  /** Необязательный машинный ключ элемента (уникален в справочнике). */
  code: z.string().min(1).nullable(),
  name: z.string().min(1),
  /** Цвет варианта списка (Р6 #631): ключ палитры тонов темы (как стадии
   *  маршрутов); null — нейтральный чип без подкраски. Назначается
   *  администратором в редакторе вариантов атрибута. */
  color: stageColorSchema.nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});

export type DictionaryItem = z.infer<typeof dictionaryItemSchema>;

/** `GET /dictionaries/:code/items` — элементы в порядке (sortOrder, name, id). */
export const listDictionaryItemsQuerySchema = cursorQuerySchema.extend({
  includeArchived: z.stringbool().default(false),
});

export type ListDictionaryItemsQuery = z.infer<typeof listDictionaryItemsQuerySchema>;

/** `GET /dictionaries` — справочники в порядке `code`. */
export const listDictionariesQuerySchema = cursorQuerySchema;

export type ListDictionariesQuery = z.infer<typeof listDictionariesQuerySchema>;

/** Запись справочников (#431, Р10): минимальный набор для вариантов
 *  атрибутов. Код генерирует сервер (`list-<8hex>`) и не меняет. Вариант
 *  несистемного справочника УДАЛЯЕТСЯ (`DELETE …/items/:id`, вердикт
 *  владельца 25.10.2026: никакого архива у вариантов атрибутов) — значения
 *  с ним читаются пустыми; системный справочник защищён (DICTIONARY_SYSTEM_LOCKED). */
export const createDictionaryBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    /** Начальные варианты; порядок — порядок ввода. */
    items: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  })
  .strict();
export type CreateDictionaryBody = z.infer<typeof createDictionaryBodySchema>;

export const updateDictionaryBodySchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();
export type UpdateDictionaryBody = z.infer<typeof updateDictionaryBodySchema>;

/**
 * Создание варианта. Цвет сознательно НЕ принимается (Р6 #631): палитра
 * назначается после создания отдельным PATCH (`updateDictionaryItemBodySchema`),
 * когда у варианта уже есть id, — так диалог атрибута создаёт варианты
 * пачкой и красит их одним проходом. Сервер цвет в create-данных не ждёт.
 */
export const createDictionaryItemBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type CreateDictionaryItemBody = z.infer<typeof createDictionaryItemBodySchema>;

export const updateDictionaryItemBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    /** Цвет варианта (Р6 #631): null — убрать цвет. */
    color: stageColorSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type UpdateDictionaryItemBody = z.infer<typeof updateDictionaryItemBodySchema>;

/** Порядок вариантов — перетаскиванием: ids = ровно активные элементы. */
export const reorderDictionaryItemsBodySchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(500) })
  .strict();
export type ReorderDictionaryItemsBody = z.infer<typeof reorderDictionaryItemsBodySchema>;
