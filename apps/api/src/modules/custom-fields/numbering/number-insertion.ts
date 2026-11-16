import type { NumberTemplateSegment } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type {
  DictionaryItemRef,
  DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';

/**
 * Печатное значение поля-вставки в номер (#630, AUD-010) — ОДНА функция для
 * выдачи и превью. Номер документа неизменяем после выдачи, поэтому
 * внутренние идентификаторы в него не попадают: список печатает код варианта
 * (как формулы, #632), число и длительность — строку числа, текст — как есть.
 * У остальных типов (ссылки, деньги, дата, флаги, составные) печатного вида
 * нет: вставка пуста, а правило с такой вставкой не сохраняется
 * (`NUMBER_SEGMENT_UNSUPPORTED`).
 */

/** Типы, у которых есть печатное значение для номера. */
const PRINTABLE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'long_text',
  'number',
  'duration',
  'enum',
]);

export function isNumberInsertionType(type: string): boolean {
  return PRINTABLE_TYPES.has(type);
}

/** Загруженные варианты списков: id варианта → печатная строка, и какие
 *  справочники уже прочитаны (шаблон может вставлять несколько полей одного
 *  списка — один запрос на справочник). */
export interface InsertionCodeCache {
  readonly codes: Map<string, string>;
  readonly dictionaries: Set<string>;
}

export function insertionCodeCache(): InsertionCodeCache {
  return { codes: new Map(), dictionaries: new Set() };
}

/**
 * Печатное значение вставки по типу поля. Пустое/несовместимое значение —
 * пустая строка: выдача спрашивает подтверждение (`NUMBER_SEGMENT_EMPTY`),
 * как для любого незаполненного поля, а не печатает мусор.
 */
export function numberInsertionValue(
  field: Pick<FieldDefinitionRow, 'type'> | undefined,
  raw: unknown,
  codes: ReadonlyMap<string, string>,
): string {
  if (!field || raw === null || raw === undefined) return '';
  switch (field.type) {
    case 'text':
    case 'long_text':
      return typeof raw === 'string' ? raw : '';
    case 'number':
    case 'duration':
      return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : '';
    case 'enum':
      // UUID варианта в номер не печатается никогда: мёртвый вариант (нет в
      // справочнике) даёт пустую вставку, а не внутренний id.
      return typeof raw === 'string' && raw.length > 0 ? (codes.get(raw) ?? '') : '';
    default:
      return '';
  }
}

/** Варианты списков, вставленных в шаблон: печатная строка — код, без кода
 *  подпись (как `toFormulaValue`). Один запрос на справочник; повторный
 *  вызов с тем же кэшем запросов не делает. */
export async function loadInsertionCodes(
  dictionaries: DictionaryReader,
  definitions: readonly FieldDefinitionRow[],
  template: readonly NumberTemplateSegment[],
  tx: TransactionClient | undefined,
  cache: InsertionCodeCache,
): Promise<void> {
  const byNumber = new Map(definitions.map((row) => [row.number, row]));
  const dictionaryIds = new Set<string>();
  for (const segment of template) {
    if (segment.kind !== 'field') continue;
    const definition = byNumber.get(segment.fieldNumber);
    if (!definition || definition.type !== 'enum') continue;
    const settings = definition.settings as { dictionaryId?: unknown } | null;
    const dictionaryId = settings?.dictionaryId;
    if (typeof dictionaryId === 'string' && !cache.dictionaries.has(dictionaryId)) {
      dictionaryIds.add(dictionaryId);
    }
  }
  for (const dictionaryId of dictionaryIds) {
    cache.dictionaries.add(dictionaryId);
    const items: DictionaryItemRef[] = await dictionaries.itemsOf(dictionaryId, tx);
    for (const item of items) cache.codes.set(item.id, item.code ?? item.name);
  }
}
