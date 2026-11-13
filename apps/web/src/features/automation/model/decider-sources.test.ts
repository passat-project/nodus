import { describe, expect, it } from 'vitest';

import { defaultDeciderSource } from './decider-sources.js';

const FIELD_ID = '00000000-0000-4000-8000-0000000000f1';

describe('defaultDeciderSource (#433)', () => {
  it('руководитель и роль проекта — безопасные умолчания', () => {
    expect(defaultDeciderSource('manager_of', [])).toEqual({
      kind: 'manager_of',
      of: 'creator',
    });
    expect(defaultDeciderSource('project_role', [])).toEqual({
      kind: 'project_role',
      role: 'manager',
    });
  });

  it('сотрудники — пустой набор до выбора (проверка публикации подсветит)', () => {
    expect(defaultDeciderSource('employees', [])).toEqual({
      kind: 'employees',
      userIds: [],
    });
  });

  it('поле: первый user-атрибут, null если их нет', () => {
    expect(defaultDeciderSource('field', [FIELD_ID])).toEqual({
      kind: 'field',
      field: `cf.${FIELD_ID}`,
    });
    expect(defaultDeciderSource('field', [])).toBeNull();
  });
});
