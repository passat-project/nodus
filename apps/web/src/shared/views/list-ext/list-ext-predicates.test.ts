import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';

import type { FilterFieldDef, FilterState } from '../list-filters.js';
import { sanitizeSavedViewExt, splitAttributeFilter } from './list-ext-predicates.js';

/** Минимальное определение атрибута для перевода (тип + валюта). */
function def(id: string, type: CustomFieldDefinition['type'], currencyId?: string | null) {
  return {
    id,
    type,
    settings: currencyId ? { currencyId } : {},
    name: id,
  } as CustomFieldDefinition;
}

const TEXT = def('11111111-1111-4111-8111-111111111111', 'text');
const NUMBER = def('22222222-2222-4222-8222-222222222222', 'number');
const DATE = def('33333333-3333-4333-8333-333333333333', 'date');
const ENUM = def('44444444-4444-4444-8444-444444444444', 'enum');
const MULTIENUM = def('55555555-5555-4555-8555-555555555555', 'multienum');
const USER = def('66666666-6666-4666-8666-666666666666', 'users');
const BOOL = def('77777777-7777-4777-8777-777777777777', 'bool');
const MONEY_NO_CURRENCY = def('88888888-8888-4888-8888-888888888888', 'money');
const DEFS = [TEXT, NUMBER, DATE, ENUM, MULTIENUM, USER, BOOL, MONEY_NO_CURRENCY];

/** Дефы панели не участвуют в переводе (значения идут по ключам состояния). */
const noDefs: FilterFieldDef<never>[] = [];

describe('splitAttributeFilter — панель → предикаты сервера (#435)', () => {
  it('текст становится contains', () => {
    const state: FilterState = { [`cf.${TEXT.id}`]: 'изм' };
    const split = splitAttributeFilter(state, DEFS);
    expect(split.predicates).toEqual([
      { kind: 'field', field: `cf.${TEXT.id}`, op: 'contains', value: 'изм' },
    ]);
    expect(split.serverFieldIds.has(`cf.${TEXT.id}`)).toBe(true);
  });

  it('диапазон чисел — парой gte/lte', () => {
    const state: FilterState = { [`cf.${NUMBER.id}`]: { from: 10, to: 20 } };
    const split = splitAttributeFilter(state, DEFS);
    expect(split.predicates).toEqual([
      { kind: 'field', field: `cf.${NUMBER.id}`, op: 'gte', value: 10 },
      { kind: 'field', field: `cf.${NUMBER.id}`, op: 'lte', value: 20 },
    ]);
  });

  it('диапазон дат — gte от дня и lte до конца суток', () => {
    const state: FilterState = { [`cf.${DATE.id}`]: { from: '2026-10-01', to: '2026-10-31' } };
    const split = splitAttributeFilter(state, DEFS);
    expect(split.predicates).toEqual([
      { kind: 'field', field: `cf.${DATE.id}`, op: 'gte', value: '2026-10-01' },
      { kind: 'field', field: `cf.${DATE.id}`, op: 'lte', value: '2026-10-31T23:59:59.999' },
    ]);
  });

  it('enum — eq, multienum и users — in_any', () => {
    const state: FilterState = {
      [`cf.${ENUM.id}`]: 'dict-item-1',
      [`cf.${MULTIENUM.id}`]: 'dict-item-2',
      [`cf.${USER.id}`]: 'user-1',
    };
    const split = splitAttributeFilter(state, DEFS);
    expect(split.predicates).toEqual([
      { kind: 'field', field: `cf.${ENUM.id}`, op: 'eq', value: 'dict-item-1' },
      { kind: 'field', field: `cf.${MULTIENUM.id}`, op: 'in_any', value: ['dict-item-2'] },
      { kind: 'field', field: `cf.${USER.id}`, op: 'in_any', value: ['user-1'] },
    ]);
  });

  it('bool: «да» — eq true, «нет» — eq null (не заполнено)', () => {
    const split = splitAttributeFilter({ [`cf.${BOOL.id}`]: 'true' } as FilterState, DEFS);
    expect(split.predicates).toEqual([
      { kind: 'field', field: `cf.${BOOL.id}`, op: 'eq', value: true },
    ]);
    const no = splitAttributeFilter({ [`cf.${BOOL.id}`]: 'false' } as FilterState, DEFS);
    expect(no.predicates).toEqual([
      { kind: 'field', field: `cf.${BOOL.id}`, op: 'eq', value: null },
    ]);
  });

  it('деньги без валюты в настройках остаются клиентскими (не шлются)', () => {
    const split = splitAttributeFilter(
      { [`cf.${MONEY_NO_CURRENCY.id}`]: { from: 5, to: 10 } } as FilterState,
      DEFS,
    );
    expect(split.predicates).toEqual([]);
    expect(split.serverFieldIds.has(`cf.${MONEY_NO_CURRENCY.id}`)).toBe(false);
  });

  it('удалённый атрибут помечается и не шлётся', () => {
    const gone = `cf.99999999-9999-4999-8999-999999999999`;
    const split = splitAttributeFilter({ [gone]: 'x' } as FilterState, DEFS);
    expect(split.predicates).toEqual([]);
    expect([...split.removedFieldIds]).toEqual([gone]);
  });

  it('системные поля журнала не переводятся (клиентские, как раньше)', () => {
    const split = splitAttributeFilter({ stage: 'some-stage' } as FilterState, DEFS);
    expect(split.predicates).toEqual([]);
    expect(split.removedFieldIds.size).toBe(0);
  });

  it('пустые значения пропускаются', () => {
    const split = splitAttributeFilter(
      { [`cf.${TEXT.id}`]: '', [`cf.${NUMBER.id}`]: {} } as FilterState,
      DEFS,
    );
    expect(split.predicates).toEqual([]);
  });

  it('sanitizeSavedViewExt выкидывает удалённые поля из sort/group/totals', () => {
    const gone = `cf.99999999-9999-4999-8999-999999999999`;
    const view: Parameters<typeof sanitizeSavedViewExt>[0] = {
      filter: [
        { kind: 'type_is', typeId: 't1' },
        { kind: 'field', field: gone, op: 'eq', value: 'x' },
      ],
      sort: [
        { field: gone, dir: 'asc' },
        { field: 'title', dir: 'desc' },
      ],
      group: { field: gone },
      totals: [
        { fn: 'count' },
        { fn: 'sum', field: gone },
        { fn: 'sum', field: `cf.${NUMBER.id}` },
      ],
    };
    const clean = sanitizeSavedViewExt(view, DEFS);
    expect(clean.filter).toEqual([{ kind: 'type_is', typeId: 't1' }]);
    expect(clean.sort).toEqual([{ field: 'title', dir: 'desc' }]);
    expect(clean.group).toBeUndefined();
    expect(clean.totals).toEqual([{ fn: 'count' }, { fn: 'sum', field: `cf.${NUMBER.id}` }]);
  });
});

void noDefs;
