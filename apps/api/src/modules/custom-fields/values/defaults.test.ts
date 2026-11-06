import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';

import { CustomFieldDefaults } from './defaults.js';

/**
 * Умолчания при создании (#431, Р5): статическое значение, «подразделение
 * автора» (снимок), пропуск невалидного умолчания без поломки создания.
 */

const definition = (
  overrides: Partial<CustomFieldDefinition> & Pick<CustomFieldDefinition, 'id' | 'type'>,
): CustomFieldDefinition =>
  ({
    number: 1,
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
    createdAt: '2026-10-26T00:00:00.000Z',
    updatedAt: '2026-10-26T00:00:00.000Z',
    ...overrides,
  }) as CustomFieldDefinition;

const DEPARTMENT = '33333333-3333-4333-8333-333333333333';

function makeDefaults(departmentOf: string | null = DEPARTMENT) {
  const org = {
    subordinateIds: vi.fn(),
    departmentOf: vi.fn(async () => departmentOf),
    departmentRefs: vi.fn(),
  };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { defaults: new CustomFieldDefaults(org as never, logger as never), org, logger };
}

describe('CustomFieldDefaults (#431, Р5)', () => {
  it('статическое значение и подразделение автора', async () => {
    const { defaults, org } = makeDefaults();
    const values = await defaults.resolve(
      [
        definition({
          id: 'f-text',
          type: 'text',
          defaultValue: { kind: 'static', value: 'Минск' },
        }),
        definition({
          id: 'f-dep',
          type: 'department',
          defaultValue: { kind: 'author_department' },
        }),
        definition({ id: 'f-none', type: 'text' }),
      ],
      'author-1',
    );
    expect(values).toEqual({ 'f-text': 'Минск', 'f-dep': DEPARTMENT });
    // Подразделение спрашивается один раз на пачку, не на поле.
    expect(org.departmentOf).toHaveBeenCalledTimes(1);
  });

  it('автор без подразделения — умолчание пропускается, не ошибка', async () => {
    const { defaults } = makeDefaults(null);
    const values = await defaults.resolve(
      [
        definition({
          id: 'f-dep',
          type: 'department',
          defaultValue: { kind: 'author_department' },
        }),
      ],
      'author-1',
    );
    expect(values).toEqual({});
  });

  it('умолчание, не подходящее типу, пропускается с предупреждением', async () => {
    const { defaults, logger } = makeDefaults();
    const values = await defaults.resolve(
      [definition({ id: 'f-num', type: 'number', defaultValue: { kind: 'static', value: 'abc' } })],
      'author-1',
    );
    expect(values).toEqual({});
    expect(logger.warn).toHaveBeenCalled();
  });

  it('нет умолчаний — порт не спрашивается', async () => {
    const { defaults, org } = makeDefaults();
    expect(await defaults.resolve([definition({ id: 'f', type: 'text' })], 'author-1')).toEqual({});
    expect(org.departmentOf).not.toHaveBeenCalled();
  });
});
