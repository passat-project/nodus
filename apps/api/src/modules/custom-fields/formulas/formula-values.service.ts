import { Inject, Injectable } from '@nestjs/common';
import type {
  CustomFieldDefinition,
  CustomFieldValue,
  CustomFieldValues,
  MoneyValue,
} from '@nodus/contracts';
import { customFieldValueSchemaOf } from '@nodus/contracts';
import type { FormulaRecord, FormulaValue } from '@nodus/formula-engine';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  DICTIONARY_READER,
  type DictionaryItemRef,
  type DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';
import type { FormulaRecordData } from '../ports/record-values.port.js';

/** Тип атрибута в объёме конвертации (номер, тип, справочник). */
type DefinitionLike = Pick<FieldDefinitionRow, 'id' | 'number' | 'type'> & {
  settings: unknown;
};

/**
 * Конвертация значений между хранилищем и языком формул (#632, Р2/Р13):
 * - в формулу: перечисления — КОД варианта («КЖ»), списки/сотрудники —
 *   массив кодов/ids, деньги — `{amount, currencyId}`, число/длительность —
 *   number, дата/время/текст — строка, bool — boolean;
 * - из формулы: обратная грамматика типа атрибута (код → id варианта),
 *   несовместимое значение не материализуется (null + type_mismatch).
 */
@Injectable()
export class FormulaValuesService {
  constructor(@Inject(DICTIONARY_READER) private readonly dictionaries: DictionaryReader) {}

  /** Варианты справочников для значений записей — одной пачкой (Р9). */
  async loadItems(
    records: readonly Pick<FormulaRecordData, 'values'>[],
    byId: ReadonlyMap<string, DefinitionLike>,
    tx?: TransactionClient,
    cache?: Map<string, DictionaryItemRef>,
  ): Promise<ReadonlyMap<string, DictionaryItemRef>> {
    const ids = new Set<string>();
    for (const record of records) {
      for (const [fieldId, raw] of Object.entries(record.values)) {
        const definition = byId.get(fieldId);
        if (!definition) continue;
        if (definition.type === 'enum') {
          if (typeof raw === 'string') ids.add(raw);
        } else if (definition.type === 'multienum' && Array.isArray(raw)) {
          for (const id of raw) if (typeof id === 'string') ids.add(id);
        }
      }
    }
    const target = cache ?? new Map<string, DictionaryItemRef>();
    for (const id of target.keys()) ids.delete(id);
    if (ids.size > 0) {
      const items = await this.dictionaries.itemRefs([...ids], tx);
      for (const item of items) target.set(item.id, item);
    }
    return target;
  }

  /** Запись-источник в языке формул: значения по номеру + системные поля. */
  toRecord(
    data: Pick<FormulaRecordData, 'values' | 'system'>,
    byNumber: ReadonlyMap<number, DefinitionLike>,
    items: ReadonlyMap<string, DictionaryItemRef>,
  ): FormulaRecord {
    const byId = new Map<string, DefinitionLike>();
    for (const definition of byNumber.values()) byId.set(definition.id, definition);
    const values = data.values;
    return {
      value: (number: number) => {
        const definition = byNumber.get(number);
        if (!definition) return undefined;
        const raw = values[definition.id];
        if (raw === undefined || raw === null) return undefined;
        return toFormulaValue(definition, raw, items);
      },
      system: (key: string) => data.system[key],
    };
  }

  /** Значение формулы → значение атрибута (грамматика типа, Р13). */
  async materialize(
    definition: Pick<CustomFieldDefinition, 'type' | 'settings'>,
    value: FormulaValue,
    tx?: TransactionClient,
  ): Promise<CustomFieldValue | null> {
    if (value === null) return null;
    switch (definition.type) {
      case 'enum':
        return this.dictionaryItemId(definition, String(value), tx);
      case 'multienum': {
        const labels = Array.isArray(value) ? value : [String(value)];
        const ids = await Promise.all(
          labels.map((label) => this.dictionaryItemId(definition, String(label), tx)),
        );
        return ids.filter((id): id is string => id !== null);
      }
      case 'bool':
        // Грамматика bool: хранится только true (отсутствие = false).
        return value === true ? true : null;
      default: {
        const parsed = customFieldValueSchemaOf(definition).safeParse(value);
        return parsed.success ? (parsed.data as CustomFieldValue) : null;
      }
    }
  }

  /** Вариант справочника по КОДУ (или подписи) — id для хранения (Р13). */
  private async dictionaryItemId(
    definition: Pick<CustomFieldDefinition, 'settings'>,
    label: string,
    tx?: TransactionClient,
  ): Promise<string | null> {
    const dictionaryId = definition.settings.dictionaryId;
    if (!dictionaryId) return null;
    const items = await this.dictionaries.itemsOf(dictionaryId, tx);
    const match =
      items.find((item) => item.code === label) ?? items.find((item) => item.name === label);
    return match?.id ?? null;
  }
}

/** Типографские «пустые» маркеры старых данных: в формуле это пусто, не текст. */
const EMPTY_DASHES = new Set(['—', '–', '−']);

/** Значение атрибута в языке формул (#632): enum — код варианта, иначе подпись. */
export function toFormulaValue(
  definition: Pick<DefinitionLike, 'type'>,
  value: CustomFieldValue,
  items: ReadonlyMap<string, DictionaryItemRef>,
): FormulaValue {
  switch (definition.type) {
    case 'enum': {
      const item = items.get(String(value));
      const text = item ? (item.code ?? item.name) : String(value);
      return EMPTY_DASHES.has(text) ? null : text;
    }
    case 'multienum': {
      const ids = Array.isArray(value) ? value : [String(value)];
      return ids.map((id) => {
        const item = items.get(id);
        return item ? (item.code ?? item.name) : id;
      });
    }
    case 'money':
      return value as MoneyValue;
    case 'bool':
      return Boolean(value);
    case 'number':
    case 'duration':
      return typeof value === 'number' ? value : Number(value);
    default: {
      const text = String(value);
      return EMPTY_DASHES.has(text) ? null : text;
    }
  }
}

/** Значения записи (JSONB) без конвертации — для сравнения «было/стало». */
export function sameFormulaValue(
  left: CustomFieldValue | null | undefined,
  right: CustomFieldValue | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** Пустая карта значений (запись без атрибутов). */
export const EMPTY_VALUES: CustomFieldValues = {};
