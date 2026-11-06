import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { makeTaskCardFields } from './task-card-fields.js';

/** Реестр блоков карточки канбана (#403) и атрибутные блоки (#632). */

const FIELD = '55000000-0000-4000-8000-000000000001';

function attribute(extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: FIELD,
    number: 1,
    type: 'text',
    name: 'Марка',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: {
      processTypeIds: ['31000000-0000-4000-8000-000000000001'],
      projectTypeIds: [],
      nodeKindIds: [],
    },
    processCategories: ['task'],
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

describe('makeTaskCardFields (#403)', () => {
  it('тип задачи — поле карточки, видимое по умолчанию', () => {
    expect(makeTaskCardFields().find((f) => f.id === 'type')).toMatchObject({
      id: 'type',
      label: ui.tasks.fieldType,
      defaultVisible: true,
    });
  });

  it('без определений атрибутных блоков нет (старый API)', () => {
    expect(makeTaskCardFields().some((f) => f.group === 'attributes')).toBe(false);
  });

  it('атрибут задачи — блок карточки, скрытый по умолчанию (#632)', () => {
    const definition = attribute();
    const fields = makeTaskCardFields({ definitions: [definition] });
    expect(fields.find((f) => f.id === `cf.${FIELD}`)).toMatchObject({
      id: `cf.${FIELD}`,
      label: 'Марка',
      defaultVisible: false,
      group: 'attributes',
      attribute: definition,
    });
  });

  it('атрибут письма в карточку задачи не попадает', () => {
    const letterField = attribute({ processCategories: ['letter'] });
    expect(
      makeTaskCardFields({ definitions: [letterField] }).some((f) => f.group === 'attributes'),
    ).toBe(false);
  });

  it('«Проект» скрывается контекстом доски, атрибуты — независимо от него', () => {
    const fields = makeTaskCardFields({ projectVisible: false, definitions: [attribute()] });
    expect(fields.find((f) => f.id === 'project')?.defaultVisible).toBe(false);
    expect(fields.find((f) => f.id === `cf.${FIELD}`)?.defaultVisible).toBe(false);
  });
});
