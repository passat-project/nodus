import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition, CustomFieldValues } from '@nodus/contracts';

import { customFieldFilterDef } from './filter-defs.js';
import { applyListFilters, type FilterState } from '../views/list-filters.js';

const FIELD = '50000000-0000-4000-8000-000000000001';
const ITEM = '50000000-0000-4000-8000-000000000002';
const USER = '10000000-0000-4000-8000-000000000001';

function definition(
  type: CustomFieldDefinition['type'],
  extra: Partial<CustomFieldDefinition> = {},
) {
  return {
    id: FIELD,
    number: 1,
    type,
    name: 'Поле',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
    ...extra,
  } satisfies CustomFieldDefinition;
}

type Row = { id: string; customFields?: CustomFieldValues };
const rows: Row[] = [
  { id: 'a', customFields: { [FIELD]: '№ 118-2026' } },
  { id: 'b', customFields: { [FIELD]: '№ 77' } },
  { id: 'c', customFields: {} },
];

function filter(
  type: CustomFieldDefinition['type'],
  value: unknown,
  extra?: Partial<CustomFieldDefinition>,
) {
  const [def] = customFieldFilterDef<Row>(
    definition(type, extra),
    (row) => row.customFields ?? {},
    [{ value: ITEM, label: 'Проектирование' }],
    [{ value: USER, label: 'Иван Петров' }],
    [{ value: 'dep', label: 'BIM-отдел' }],
    [{ value: 'proj', label: 'Проект' }],
  );
  const state: FilterState = { [def!.id]: value as never };
  return applyListFilters(rows, [def!], state, '').map((row) => row.id);
}

describe('фильтры кастомных полей (#431, Р8)', () => {
  it('текст: «содержит», пусто — все', () => {
    expect(filter('text', '118')).toEqual(['a']);
    expect(filter('text', '')).toEqual(['a', 'b', 'c']);
  });

  it('ссылка ищется как текст (URL/путь)', () => {
    expect(filter('link', 'srv')).toEqual([]);
  });

  it('число и деньги: диапазон', () => {
    const [number] = customFieldFilterDef<Row>(
      definition('number', { settings: { precision: 2 } }),
      (row) => row.customFields ?? {},
      [],
      [],
      [],
      [],
    );
    const data: Row[] = [
      { id: 'x', customFields: { [FIELD]: 5 } },
      { id: 'y', customFields: { [FIELD]: 50 } },
    ];
    const state: FilterState = { [number!.id]: { from: 10, to: 100 } };
    expect(applyListFilters(data, [number!], state, '').map((r) => r.id)).toEqual(['y']);
  });

  it('продолжительность: диапазон в минутах', () => {
    const [duration] = customFieldFilterDef<Row>(
      definition('duration'),
      (row) => row.customFields ?? {},
      [],
      [],
      [],
      [],
    );
    expect(duration?.numberFormat).toBe('duration');
    const data: Row[] = [
      { id: 'x', customFields: { [FIELD]: 90 } },
      { id: 'y', customFields: { [FIELD]: 240 } },
    ];
    const state: FilterState = { [duration!.id]: { from: 120 } };
    expect(applyListFilters(data, [duration!], state, '').map((r) => r.id)).toEqual(['y']);
  });

  it('дата: диапазон по дню (время срезается)', () => {
    const data: Row[] = [
      { id: 'x', customFields: { [FIELD]: '2026-10-20T09:00:00.000Z' } },
      { id: 'y', customFields: { [FIELD]: '2026-11-02T10:00:00.000Z' } },
    ];
    const [date] = customFieldFilterDef<Row>(
      definition('datetime'),
      (row) => row.customFields ?? {},
      [],
      [],
      [],
      [],
    );
    const state: FilterState = { [date!.id]: { from: '2026-10-01', to: '2026-10-31' } };
    expect(applyListFilters(data, [date!], state, '').map((r) => r.id)).toEqual(['x']);
  });

  it('список: выбор элемента; несколько — вхождение', () => {
    const single = customFieldFilterDef<Row>(
      definition('enum', { settings: { dictionaryId: 'dict' } }),
      (row) => row.customFields ?? {},
      [{ value: ITEM, label: 'Проектирование' }],
      [],
      [],
      [],
    )[0]!;
    expect(
      applyListFilters(
        [{ id: 'x', customFields: { [FIELD]: ITEM } }],
        [single],
        { [single.id]: ITEM },
        '',
      ),
    ).toHaveLength(1);

    const multi = customFieldFilterDef<Row>(
      definition('multienum', { settings: { dictionaryId: 'dict' } }),
      (row) => row.customFields ?? {},
      [{ value: ITEM, label: 'Проектирование' }],
      [],
      [],
      [],
    )[0]!;
    expect(
      applyListFilters(
        [{ id: 'x', customFields: { [FIELD]: ['50000000-0000-4000-8000-000000000099', ITEM] } }],
        [multi],
        { [multi.id]: ITEM },
        '',
      ),
    ).toHaveLength(1);
  });

  it('сотрудник: одиночный и несколько', () => {
    const [user] = customFieldFilterDef<Row>(
      definition('user'),
      (row) => row.customFields ?? {},
      [],
      [{ value: USER, label: 'Иван Петров' }],
      [],
      [],
    );
    expect(
      applyListFilters(
        [{ id: 'x', customFields: { [FIELD]: USER } }],
        [user!],
        { [user!.id]: USER },
        '',
      ),
    ).toHaveLength(1);

    const [users] = customFieldFilterDef<Row>(
      definition('users'),
      (row) => row.customFields ?? {},
      [],
      [{ value: USER, label: 'Иван Петров' }],
      [],
      [],
    );
    expect(
      applyListFilters(
        [{ id: 'x', customFields: { [FIELD]: [USER] } }],
        [users!],
        { [users!.id]: USER },
        '',
      ),
    ).toHaveLength(1);
  });

  it('флаг: Да/Нет', () => {
    const [bool] = customFieldFilterDef<Row>(
      definition('bool'),
      (row) => row.customFields ?? {},
      [],
      [],
      [],
      [],
    );
    const data: Row[] = [
      { id: 'x', customFields: { [FIELD]: true } },
      { id: 'y', customFields: {} },
    ];
    expect(applyListFilters(data, [bool!], { [bool!.id]: 'true' }, '').map((r) => r.id)).toEqual([
      'x',
    ]);
    expect(applyListFilters(data, [bool!], { [bool!.id]: 'false' }, '').map((r) => r.id)).toEqual([
      'y',
    ]);
  });

  it('контрагент — фильтра нет до #435', () => {
    expect(
      customFieldFilterDef<Row>(
        definition('counterparty'),
        (row) => row.customFields ?? {},
        [],
        [],
        [],
        [],
      ),
    ).toEqual([]);
  });

  it('группа «Атрибуты» у всех фильтров', () => {
    const [def] = customFieldFilterDef<Row>(
      definition('text'),
      (row) => row.customFields ?? {},
      [],
      [],
      [],
      [],
    );
    expect(def?.group).toBe('Атрибуты');
  });
});
