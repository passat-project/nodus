import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldValue } from '@nodus/contracts';

import { FormulaValuesService, toFormulaValue } from './formula-values.service.js';
import type {
  DictionaryItemRef,
  DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';

const item = (id: string, code: string | null, name: string): DictionaryItemRef => ({
  id,
  dictionaryId: 'd1',
  code,
  name,
  isActive: true,
  color: null,
});

function reader(): DictionaryReader {
  const items = [item('i1', 'KJ', 'Конструкции железобетонные'), item('i2', null, 'Без кода')];
  return {
    dictionaryRefs: vi.fn(async () => []),
    itemRefs: vi.fn(async (ids: readonly string[]) =>
      items.filter((entry) => ids.includes(entry.id)),
    ),
    activeItemRef: vi.fn(async () => null),
    itemsOf: vi.fn(async () => items),
    dictionaryIdByCode: vi.fn(async () => null),
    activeItemByCode: vi.fn(async () => null),
  };
}

describe('toFormulaValue: значение атрибута → язык формул', () => {
  it('enum отдаёт КОД варианта, без кода — подпись', () => {
    const items = new Map([
      ['i1', item('i1', 'KJ', 'Конструкции железобетонные')],
      ['i2', item('i2', null, 'Без кода')],
    ]);
    expect(toFormulaValue({ type: 'enum' }, 'i1', items)).toBe('KJ');
    expect(toFormulaValue({ type: 'enum' }, 'i2', items)).toBe('Без кода');
    // Значение удалённого варианта остаётся читаемым как id.
    expect(toFormulaValue({ type: 'enum' }, 'gone', items)).toBe('gone');
  });

  it('multienum — массив кодов; деньги — объект; bool — boolean; число — number', () => {
    const items = new Map([['i1', item('i1', 'KJ', 'КЖ')]]);
    expect(toFormulaValue({ type: 'multienum' }, ['i1', 'i2'] as CustomFieldValue, items)).toEqual([
      'KJ',
      'i2',
    ]);
    expect(toFormulaValue({ type: 'money' }, { amount: 12.5, currencyId: 'c1' }, items)).toEqual({
      amount: 12.5,
      currencyId: 'c1',
    });
    expect(toFormulaValue({ type: 'bool' }, true, items)).toBe(true);
    expect(toFormulaValue({ type: 'number' }, 7, items)).toBe(7);
    expect(toFormulaValue({ type: 'text' }, 'abc', items)).toBe('abc');
  });
});

describe('FormulaValuesService.materialize: язык формул → значение атрибута', () => {
  const service = new FormulaValuesService(reader());

  it('enum: код варианта → id; неизвестный код не материализуется', async () => {
    expect(
      await service.materialize({ type: 'enum', settings: { dictionaryId: 'd1' } }, 'KJ'),
    ).toBe('i1');
    expect(
      await service.materialize({ type: 'enum', settings: { dictionaryId: 'd1' } }, 'нет такого'),
    ).toBeNull();
  });

  it('multienum: список кодов → список id', async () => {
    expect(
      await service.materialize({ type: 'multienum', settings: { dictionaryId: 'd1' } }, [
        'KJ',
        'Без кода',
      ]),
    ).toEqual(['i1', 'i2']);
  });

  it('bool: false не хранится (грамматика «только true») — null', async () => {
    expect(await service.materialize({ type: 'bool', settings: {} }, false)).toBeNull();
    expect(await service.materialize({ type: 'bool', settings: {} }, true)).toBe(true);
  });

  it('несовместимое значение не материализуется', async () => {
    expect(await service.materialize({ type: 'number', settings: {} }, 'строка')).toBeNull();
    expect(await service.materialize({ type: 'date', settings: {} }, 'вчера')).toBeNull();
  });
});
