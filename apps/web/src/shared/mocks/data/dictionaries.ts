import type { Dictionary, DictionaryItem } from '@nodus/contracts';
import { RECEIPT_METHOD_CODES, SystemDictionary, type ReceiptMethodCode } from '@nodus/contracts';

import { SET_MARK_DICTIONARY_ID, SET_MARKS, setMarkItemId } from './set-marks.js';

/** Демо-справочники (#431, Р10): системные `currency`, `document-kind`,
 *  `receipt-method` (способы поступления писем, #55 Р14) и пользовательские
 *  «Виды работ», «Объекты». Значения полей ссылаются на id элементов (I15). */

const did = (n: number): string => `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iid = (n: number): string => `d2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const dictionaryIds = {
  currency: did(1),
  documentKind: did(2),
  workKind: did(3),
  object: did(4),
  receiptMethod: did(5),
  setMark: SET_MARK_DICTIONARY_ID,
};

const kid = (n: number): string => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Способы поступления (Р14): коды стабильны — умолчание формы регистрации
 *  берётся по коду (бумага → «Почта», почта #56 → «Электронная почта»). */
export const receiptMethodIds = {
  email: iid(31),
  post: iid(32),
  courier: iid(33),
  smdo: iid(34),
} as const satisfies Record<ReceiptMethodCode, string>;

export const currencyIds = {
  byn: iid(1),
  rub: iid(2),
  usd: iid(3),
  eur: iid(4),
  cny: iid(5),
};

export const workKindIds = {
  design: iid(11),
  approval: iid(12),
  expertise: iid(13),
};

export const objectIds = {
  main: iid(21),
  warehouse: iid(22),
  admin: iid(23),
};

export const demoDictionaries: Dictionary[] = [
  {
    id: dictionaryIds.currency,
    code: SystemDictionary.CURRENCY,
    name: 'Валюты',
    hierarchical: false,
    isSystem: true,
  },
  {
    id: dictionaryIds.documentKind,
    code: SystemDictionary.DOCUMENT_KIND,
    name: 'Виды документов',
    hierarchical: false,
    isSystem: true,
  },
  {
    id: dictionaryIds.receiptMethod,
    code: SystemDictionary.RECEIPT_METHOD,
    name: 'Способы поступления',
    hierarchical: false,
    isSystem: true,
  },
  {
    id: dictionaryIds.workKind,
    code: 'work-kind',
    name: 'Виды работ',
    hierarchical: false,
    isSystem: false,
  },
  {
    id: dictionaryIds.object,
    code: 'object',
    name: 'Объекты',
    hierarchical: false,
    isSystem: false,
  },
  {
    id: dictionaryIds.setMark,
    code: 'set-mark',
    name: 'Марки комплектов',
    hierarchical: false,
    isSystem: false,
  },
];

function item(
  id: string,
  dictionaryId: string,
  name: string,
  sortOrder: number,
  isActive = true,
  code: string | null = null,
  color: DictionaryItem['color'] = null,
): DictionaryItem {
  return { id, dictionaryId, parentId: null, code, name, color, sortOrder, isActive };
}

const documentKinds = ['Письмо', 'Договор', 'Приказ', 'Запрос', 'Акт'];

/** Цвета основных марок (демо раскраски чипов, Р6 #631). */
const SET_MARK_COLORS: Partial<Record<string, DictionaryItem['color']>> = {
  ГП: 'neutral',
  АР: 'warning',
  КР: 'danger',
  ИОС: 'info',
  ОВ: 'info',
  ЭОМ: 'violet',
  КЖ: 'teal',
  КМ: 'orange',
  СС: 'pink',
  АУС: 'cyan',
};

export const demoDictionaryItems: DictionaryItem[] = [
  item(currencyIds.byn, dictionaryIds.currency, 'BYN', 0),
  item(currencyIds.rub, dictionaryIds.currency, 'RUB', 1),
  item(currencyIds.usd, dictionaryIds.currency, 'USD', 2),
  item(currencyIds.eur, dictionaryIds.currency, 'EUR', 3),
  item(currencyIds.cny, dictionaryIds.currency, 'CNY', 4),
  ...documentKinds.map((name, index) =>
    item(kid(index + 1), dictionaryIds.documentKind, name, index),
  ),
  item(
    receiptMethodIds.email,
    dictionaryIds.receiptMethod,
    'Электронная почта',
    0,
    true,
    RECEIPT_METHOD_CODES.email,
  ),
  item(
    receiptMethodIds.post,
    dictionaryIds.receiptMethod,
    'Почта',
    1,
    true,
    RECEIPT_METHOD_CODES.post,
  ),
  item(
    receiptMethodIds.courier,
    dictionaryIds.receiptMethod,
    'Нарочным',
    2,
    true,
    RECEIPT_METHOD_CODES.courier,
  ),
  item(
    receiptMethodIds.smdo,
    dictionaryIds.receiptMethod,
    'СМДО',
    3,
    true,
    RECEIPT_METHOD_CODES.smdo,
  ),
  item(workKindIds.design, dictionaryIds.workKind, 'Проектирование', 0),
  item(workKindIds.approval, dictionaryIds.workKind, 'Согласование', 1),
  item(workKindIds.expertise, dictionaryIds.workKind, 'Экспертиза', 2),
  item(objectIds.main, dictionaryIds.object, 'Главный корпус', 0),
  item(objectIds.warehouse, dictionaryIds.object, 'Склад готовой продукции', 1),
  item(objectIds.admin, dictionaryIds.object, 'Административный корпус', 2),
  // Марки комплектов (#556): код элемента — марка СТБ 2255 (разбор колонки
  // штампа в #468), имя — «ОВ — Отопление, вентиляция…» (В2). Цвета
  // основных марок — палитра темы (Р6 #631), остальные — без цвета.
  ...SET_MARKS.map((mark, index) =>
    item(
      setMarkItemId(index),
      dictionaryIds.setMark,
      `${mark.code} — ${mark.name}`,
      index * 10,
      true,
      mark.code,
      SET_MARK_COLORS[mark.code] ?? null,
    ),
  ),
];

export function dictionaryByCode(code: string): Dictionary | undefined {
  return demoDictionaries.find((dictionary) => dictionary.code === code);
}

export function dictionaryById(id: string): Dictionary | undefined {
  return demoDictionaries.find((dictionary) => dictionary.id === id);
}

export function itemsOf(code: string, includeArchived = false): DictionaryItem[] {
  const dictionary = dictionaryByCode(code);
  if (!dictionary) return [];
  return demoDictionaryItems
    .filter((entry) => entry.dictionaryId === dictionary.id)
    .filter((entry) => includeArchived || entry.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function itemById(id: string): DictionaryItem | undefined {
  return demoDictionaryItems.find((entry) => entry.id === id);
}

/** Код нового справочника генерирует «сервер»: `list-<8hex>` (неизменен). */
export function nextDictionaryCode(): string {
  return `list-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}
