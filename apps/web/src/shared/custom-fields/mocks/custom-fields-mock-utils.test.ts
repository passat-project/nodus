import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';

import { demoAuthorDepartment } from '../../mocks/data/custom-fields.js';
import { withStaticDefaults } from './custom-fields-mock-utils.js';

/**
 * Умолчания при создании записи (#655): мок проектов и папок применяет их
 * тем же помощником, что задачи, — статическое значение И «подразделение
 * автора»; явное значение важнее; глобальная переменная не подставляется.
 * Сервер делает то же в `prepareCreate`.
 */

const TEXT = '11111111-1111-4111-8111-111111111111';
const DEPARTMENT = '22222222-2222-4222-8222-222222222222';
const COMPANY = '33333333-3333-4333-8333-333333333333';

function definition(id: string, extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type: 'text',
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
  };
}

describe('withStaticDefaults (#655)', () => {
  it('статическое умолчание и «подразделение автора» — как сервер', () => {
    const staticText = definition(TEXT, {
      defaultValue: { kind: 'static', value: 'по умолчанию' },
    });
    const department = definition(DEPARTMENT, {
      type: 'department',
      defaultValue: { kind: 'author_department' },
    });
    const values = withStaticDefaults([staticText, department, definition(COMPANY)], {});
    expect(values[TEXT]).toBe('по умолчанию');
    expect(values[DEPARTMENT]).toBe(demoAuthorDepartment());
    expect(values[COMPANY]).toBeUndefined();
  });

  it('явное значение важнее умолчания', () => {
    const text = definition(TEXT, { defaultValue: { kind: 'static', value: 'умолчание' } });
    expect(withStaticDefaults([text], { [TEXT]: 'руками' })[TEXT]).toBe('руками');
  });

  it('умолчание вне набора привязанных атрибутов не подставляется', () => {
    const text = definition(TEXT, { defaultValue: { kind: 'static', value: 'умолчание' } });
    expect(withStaticDefaults([], {})[TEXT]).toBeUndefined();
    expect(withStaticDefaults([definition(DEPARTMENT)], {})[TEXT]).toBeUndefined();
    expect(text.id).toBe(TEXT);
  });
});
