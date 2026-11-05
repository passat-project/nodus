import { describe, expect, it } from 'vitest';

import { defaultDeciderSource } from './decider-sources.js';

const POSITION = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Зам директора',
  kind: 'management' as const,
  sortOrder: 0,
  isActive: true,
};
const FIELD_ID = '00000000-0000-4000-8000-0000000000f1';

describe('defaultDeciderSource (#433)', () => {
  it('должность: первая из активного справочника, null без должностей', () => {
    expect(defaultDeciderSource('position', [POSITION], [])).toEqual({
      kind: 'position',
      positionId: POSITION.id,
      positionKind: 'management',
    });
    expect(defaultDeciderSource('position', [], [FIELD_ID])).toBeNull();
  });

  it('руководитель и роль проекта — безопасные умолчания', () => {
    expect(defaultDeciderSource('manager_of', [], [])).toEqual({
      kind: 'manager_of',
      of: 'creator',
    });
    expect(defaultDeciderSource('project_role', [], [])).toEqual({
      kind: 'project_role',
      role: 'manager',
    });
  });

  it('сотрудники — пустой набор до выбора (проверка публикации подсветит)', () => {
    expect(defaultDeciderSource('employees', [], [])).toEqual({
      kind: 'employees',
      userIds: [],
    });
  });

  it('поле: первый user-атрибут, null если их нет', () => {
    expect(defaultDeciderSource('field', [], [FIELD_ID])).toEqual({
      kind: 'field',
      field: `cf.${FIELD_ID}`,
    });
    expect(defaultDeciderSource('field', [], [])).toBeNull();
  });
});
