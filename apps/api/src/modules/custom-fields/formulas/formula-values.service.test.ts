import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldValue } from '@nodus/contracts';

import { FormulaValuesService, toFormulaValue } from './formula-values.service.js';
import type {
  DictionaryItemRef,
  DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';
import type { UserProfileReader } from '../../../core/ports/user-profile.port.js';

/** id вариантов справочника — uuid (грамматика multienum проверяет формат). */
const KJ = '10000000-0000-4000-8000-000000000001';
const NO_CODE = '10000000-0000-4000-8000-000000000002';
const ARCHIVED = '10000000-0000-4000-8000-000000000003';
/** Сотрудники: u1/u2 действующие, u3 деактивирован (A8-5). */
const U1 = '20000000-0000-4000-8000-000000000001';
const U2 = '20000000-0000-4000-8000-000000000002';
const U3 = '20000000-0000-4000-8000-000000000003';

const item = (id: string, code: string | null, name: string, active = true): DictionaryItemRef => ({
  id,
  dictionaryId: 'd1',
  code,
  name,
  isActive: active,
  color: null,
});

function reader(): DictionaryReader {
  const items = [
    item(KJ, 'KJ', 'Конструкции железобетонные'),
    item(NO_CODE, null, 'Без кода'),
    item(ARCHIVED, 'OLD', 'Архивный вариант', false),
  ];
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

/** Порт сотрудников: действующие — u1/u2; u3 деактивирован (A8-5). */
function profiles(): UserProfileReader {
  return {
    findRefs: vi.fn(async () => []),
    searchByDisplayName: vi.fn(async () => []),
    filterActiveUserIds: vi.fn(async (ids: string[]) => ids.filter((id) => id !== U3)),
  };
}

describe('toFormulaValue: значение атрибута → язык формул', () => {
  it('enum отдаёт КОД варианта, без кода — подпись', () => {
    const items = new Map([
      [KJ, item(KJ, 'KJ', 'Конструкции железобетонные')],
      [NO_CODE, item(NO_CODE, null, 'Без кода')],
    ]);
    expect(toFormulaValue({ type: 'enum' }, KJ, items)).toBe('KJ');
    expect(toFormulaValue({ type: 'enum' }, NO_CODE, items)).toBe('Без кода');
    // Значение удалённого варианта остаётся читаемым как id.
    expect(toFormulaValue({ type: 'enum' }, 'gone', items)).toBe('gone');
  });

  it('multienum — массив кодов; деньги — объект; bool — boolean; число — number', () => {
    const items = new Map([[KJ, item(KJ, 'KJ', 'КЖ')]]);
    expect(toFormulaValue({ type: 'multienum' }, [KJ, 'gone'] as CustomFieldValue, items)).toEqual([
      'KJ',
      'gone',
    ]);
    expect(toFormulaValue({ type: 'money' }, { amount: 12.5, currencyId: 'c1' }, items)).toEqual({
      amount: 12.5,
      currencyId: 'c1',
    });
    expect(toFormulaValue({ type: 'bool' }, true, items)).toBe(true);
    expect(toFormulaValue({ type: 'number' }, 7, items)).toBe(7);
    expect(toFormulaValue({ type: 'text' }, 'abc', items)).toBe('abc');
    // Легаси-маркер пустоты в любом строковом значении — пусто, не дефис.
    expect(toFormulaValue({ type: 'text' }, '—', items)).toBeNull();
    expect(toFormulaValue({ type: 'text' }, ' – ', items)).toBeNull();
  });

  it('сотрудники — массив id, а не строка «id1,id2» (A1-05)', () => {
    const items = new Map([[U1, item(U1, 'KJ', 'Иван')]]);
    expect(toFormulaValue({ type: 'users' }, [U1, U2] as CustomFieldValue, items)).toEqual([
      U1,
      U2,
    ]);
    // Скаляр расширяющего типа читается как список из одного id.
    expect(toFormulaValue({ type: 'users' }, U1 as CustomFieldValue, items)).toEqual([U1]);
  });
});

describe('FormulaValuesService.materialize: язык формул → значение атрибута', () => {
  const service = new FormulaValuesService(reader(), profiles());
  const multienum = { type: 'multienum', settings: { dictionaryId: 'd1' } } as const;

  it('enum: код варианта → id; неизвестный код не материализуется', async () => {
    expect(
      await service.materialize({ type: 'enum', settings: { dictionaryId: 'd1' } }, 'KJ'),
    ).toBe(KJ);
    expect(
      await service.materialize({ type: 'enum', settings: { dictionaryId: 'd1' } }, 'нет такого'),
    ).toBeNull();
  });

  it('enum: архивный вариант не материализуется — как ручной ввод (A8-5)', async () => {
    expect(
      await service.materialize({ type: 'enum', settings: { dictionaryId: 'd1' } }, 'OLD'),
    ).toBeNull();
  });

  it('multienum: список кодов → список id', async () => {
    expect(await service.materialize(multienum, ['KJ', 'Без кода'])).toEqual([KJ, NO_CODE]);
  });

  it('multienum: несовпавший код — null, а не подмножество (A8-2)', async () => {
    expect(await service.materialize(multienum, ['KJ', 'нет такого'])).toBeNull();
  });

  it('multienum: пустой результат — null, а не [] (A8-2)', async () => {
    expect(await service.materialize(multienum, [])).toBeNull();
    expect(await service.materialize(multienum, ['нет такого'])).toBeNull();
  });

  it('multienum: повтор кода не ломает грамматику списка (уникальные id)', async () => {
    expect(await service.materialize(multienum, ['KJ', 'KJ'])).toEqual([KJ]);
  });

  it('bool: false не хранится (грамматика «только true») — null', async () => {
    expect(await service.materialize({ type: 'bool', settings: {} }, false)).toBeNull();
    expect(await service.materialize({ type: 'bool', settings: {} }, true)).toBe(true);
  });

  it('несовместимое значение не материализуется', async () => {
    expect(await service.materialize({ type: 'number', settings: {} }, 'строка')).toBeNull();
    expect(await service.materialize({ type: 'date', settings: {} }, 'вчера')).toBeNull();
  });

  it('сотрудник: действующий принимается, деактивированный — null (A8-5)', async () => {
    const user = { type: 'user', settings: {} } as const;
    expect(await service.materialize(user, U1)).toBe(U1);
    expect(await service.materialize(user, U3)).toBeNull();
  });

  it('сотрудники: любой деактивированный — значение целиком не материализуется (A8-5)', async () => {
    const users = { type: 'users', settings: {} } as const;
    expect(await service.materialize(users, [U1, U2])).toEqual([U1, U2]);
    expect(await service.materialize(users, [U1, U3])).toBeNull();
  });

  it('сотрудники: скаляр расширяется в список из одного id (Р3)', async () => {
    expect(await service.materialize({ type: 'users', settings: {} }, U1)).toEqual([U1]);
  });
});
