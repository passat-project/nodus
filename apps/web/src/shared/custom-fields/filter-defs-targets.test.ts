import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition, CustomFieldValue, CustomFieldValues } from '@nodus/contracts';

import { customFieldFilterDef } from './filter-defs.js';
import { applyListFilters, type FilterOption, type FilterState } from '../views/list-filters.js';

/** Фильтры-ссылки атрибутов (#431/#631): подразделение — выбор; проект —
 *  только при доступном модуле (без вариантов поля нет); деньги — диапазон
 *  по сумме из значения-объекта. */
const FIELD = '54000000-0000-4000-8000-000000000001';
const DEP = '54000000-0000-4000-8000-0000000000d1';
const PROJECT = '54000000-0000-4000-8000-0000000000b1';

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
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  } satisfies CustomFieldDefinition;
}

type Row = { id: string; customFields: CustomFieldValues };

function rowsOf(...values: CustomFieldValue[]): Row[] {
  return values.map((value, index) => ({
    id: `row-${index}`,
    customFields: { [FIELD]: value } as CustomFieldValues,
  }));
}

function matchId(
  type: CustomFieldDefinition['type'],
  data: Row[],
  value: unknown,
  options: { department?: FilterOption[]; project?: FilterOption[] } = {},
): string[] {
  const [def] = customFieldFilterDef<Row>(
    definition(type),
    (row) => row.customFields,
    [],
    [],
    options.department ?? [],
    options.project ?? [],
  );
  if (!def) return ['<нет поля>'];
  const state: FilterState = { [def.id]: value as never };
  return applyListFilters(data, [def], state, '').map((row) => row.id);
}

describe('фильтр-подразделение', () => {
  it('выбор значения сравнивает id', () => {
    const data = rowsOf(DEP, '54000000-0000-4000-8000-0000000000d2');
    expect(
      matchId('department', data, DEP, {
        department: [{ value: DEP, label: 'BIM-отдел' }],
      }),
    ).toEqual(['row-0']);
  });
});

describe('фильтр-проект (Р14: модуль проектов)', () => {
  const data = rowsOf(PROJECT, '54000000-0000-4000-8000-0000000000b2');

  it('без вариантов (модуль недоступен) — поля нет', () => {
    expect(matchId('project', data, PROJECT, { project: [] })).toEqual(['<нет поля>']);
  });

  it('с вариантами — выбор по id проекта', () => {
    expect(
      matchId('project', data, PROJECT, {
        project: [
          { value: PROJECT, label: 'Школа в Микрорайоне' },
          { value: '54000000-0000-4000-8000-0000000000b2', label: 'Детский сад' },
        ],
      }),
    ).toEqual(['row-0']);
  });
});

describe('фильтр-деньги: диапазон по сумме', () => {
  it('значение-объект сравнивается по amount', () => {
    const data = rowsOf(
      { amount: 1_000, currencyId: '54000000-0000-4000-8000-0000000000c1' },
      { amount: 50_000, currencyId: '54000000-0000-4000-8000-0000000000c1' },
      'не число' as unknown as { amount: number; currencyId: string },
    );
    const [def] = customFieldFilterDef<Row>(
      definition('money'),
      (row) => row.customFields,
      [],
      [],
      [],
      [],
    );
    const state: FilterState = { [def!.id]: { from: 500, to: 10_000 } };
    expect(applyListFilters(data, [def!], state, '').map((row) => row.id)).toEqual(['row-0']);
  });
});
