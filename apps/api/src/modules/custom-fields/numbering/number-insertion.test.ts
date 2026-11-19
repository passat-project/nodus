import { describe, expect, it, vi } from 'vitest';

import { isNumberInsertionType } from '@nodus/contracts';

import type { DictionaryReader } from '../../dictionaries/ports/dictionary-reader.port.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';
import {
  insertionCodeCache,
  loadInsertionCodes,
  numberInsertionValue,
} from './number-insertion.js';

/**
 * Печатное значение вставки в номер (AUD-010): номер документа неизменяем
 * после выдачи, поэтому в него нельзя печатать внутренний id (UUID варианта
 * списка, ссылки) и `[object Object]`. Одна функция — у выдачи и у превью;
 * по одному случаю на тип, включая неподдержанные.
 */
const CODES = new Map([['item-uuid', 'КЖ']]);
const field = (type: string) => ({ type });
const enumField = (overrides: Partial<FieldDefinitionRow> = {}): FieldDefinitionRow =>
  ({
    id: 'field-enum',
    number: 1,
    type: 'enum',
    settings: { dictionaryId: 'dictionary-1' },
    ...overrides,
  }) as unknown as FieldDefinitionRow;
const textField = (overrides: Partial<FieldDefinitionRow> = {}): FieldDefinitionRow =>
  ({
    id: 'field-text',
    number: 2,
    type: 'text',
    settings: {},
    ...overrides,
  }) as unknown as FieldDefinitionRow;

describe('numberInsertionValue (AUD-010): печатное значение по типу поля', () => {
  it('текст печатается как есть', () => {
    expect(numberInsertionValue(field('text'), 'А-101', CODES)).toBe('А-101');
    expect(numberInsertionValue(field('long_text'), 'А-101', CODES)).toBe('А-101');
  });

  it('число и длительность печатаются строкой числа', () => {
    expect(numberInsertionValue(field('number'), 42, CODES)).toBe('42');
    expect(numberInsertionValue(field('number'), 42.5, CODES)).toBe('42.5');
    expect(numberInsertionValue(field('duration'), 90, CODES)).toBe('90');
  });

  it('список печатает код варианта, а не UUID', () => {
    expect(numberInsertionValue(field('enum'), 'item-uuid', CODES)).toBe('КЖ');
    // Вариант без машинного кода — подпись (как в формулах, #632).
    expect(
      numberInsertionValue(field('enum'), 'item-uuid', new Map([['item-uuid', 'Конструкция']])),
    ).toBe('Конструкция');
  });

  it('мёртвый вариант списка — пусто: UUID, которого нет в справочнике, не печатается', () => {
    expect(numberInsertionValue(field('enum'), 'dead-uuid', CODES)).toBe('');
  });

  it.each([
    'money',
    'date',
    'datetime',
    'bool',
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
    'counter',
  ])('неподдержанный тип %s — пусто, печатного вида нет', (type) => {
    const raw =
      type === 'bool'
        ? true
        : type === 'multienum' || type === 'users'
          ? ['item-uuid']
          : type === 'money'
            ? { amount: 10, currencyId: 'currency-uuid' }
            : 'item-uuid';
    expect(numberInsertionValue(field(type), raw, CODES)).toBe('');
  });

  it('пустое значение и отсутствующее поле — пусто', () => {
    expect(numberInsertionValue(field('text'), null, CODES)).toBe('');
    expect(numberInsertionValue(field('text'), undefined, CODES)).toBe('');
    expect(numberInsertionValue(field('text'), '', CODES)).toBe('');
    expect(numberInsertionValue(field('number'), Number.NaN, CODES)).toBe('');
    expect(numberInsertionValue(undefined, 'А-101', CODES)).toBe('');
  });

  it('isNumberInsertionType: печатаются только текст, число и список', () => {
    for (const type of ['text', 'long_text', 'number', 'duration', 'enum']) {
      expect(isNumberInsertionType(type), type).toBe(true);
    }
    for (const type of [
      'money',
      'date',
      'datetime',
      'bool',
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
      'counter',
    ]) {
      expect(isNumberInsertionType(type), type).toBe(false);
    }
  });
});

describe('loadInsertionCodes: варианты списков шаблона одной пачкой', () => {
  const item = (id: string, code: string | null, name: string) => ({
    id,
    dictionaryId: 'dictionary-1',
    code,
    name,
    isActive: true,
    color: null,
  });

  it('читает справочник только у вставок-списков и только один раз', async () => {
    const itemsOf = vi.fn(async () => [
      item('a', 'КЖ', 'Конструкция'),
      item('b', null, 'Без кода'),
    ]);
    const dictionaries = { itemsOf } as unknown as DictionaryReader;
    const definitions = [enumField(), textField()];
    const template = [
      { kind: 'field', fieldNumber: 1, source: 'self' },
      { kind: 'field', fieldNumber: 2, source: 'self' },
      { kind: 'counter' },
    ] as const;

    const cache = insertionCodeCache();
    await loadInsertionCodes(dictionaries, definitions, template, undefined, cache);
    await loadInsertionCodes(dictionaries, definitions, template, undefined, cache);

    expect(itemsOf).toHaveBeenCalledTimes(1);
    expect(itemsOf).toHaveBeenCalledWith('dictionary-1', undefined);
    expect(cache.codes.get('a')).toBe('КЖ');
    // Без кода — подпись, как в формулах: номер не останется пустым.
    expect(cache.codes.get('b')).toBe('Без кода');
  });

  it('шаблон без списков справочники не читает', async () => {
    const itemsOf = vi.fn(async () => []);
    const cache = insertionCodeCache();
    await loadInsertionCodes(
      { itemsOf } as unknown as DictionaryReader,
      [textField()],
      [{ kind: 'counter' }],
      undefined,
      cache,
    );
    expect(itemsOf).not.toHaveBeenCalled();
  });
});
