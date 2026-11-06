import { describe, expect, it } from 'vitest';

import {
  SYSTEM_FIELD_IDS,
  systemFieldValue,
  isSystemFieldId,
} from '../custom-fields/system-fields.js';
import { hasDuplicateSlots } from '../custom-fields/field-form.schemas.js';
import {
  projectTypeFormOf,
  requiredProjectFields,
  missingProjectFields,
  clearedProjectFields,
} from './project.schemas.js';

/** Хелперы форм мест (Р10 #631): толерантное чтение, обязательные слоты,
 *  пропуски/очистки и дубль-детектор слотов. */

const CODE = SYSTEM_FIELD_IDS.projectCode;
const CLIENT = SYSTEM_FIELD_IDS.projectClient;

describe('system-fields', () => {
  it('systemFieldValue читает ключ, null/undefined безопасны', () => {
    expect(systemFieldValue({ [CODE]: 'ПР-1' }, CODE)).toBe('ПР-1');
    expect(systemFieldValue(null, CODE)).toBeUndefined();
    expect(systemFieldValue(undefined, CODE)).toBeUndefined();
    expect(systemFieldValue({ other: 1 }, CODE)).toBeUndefined();
  });

  it('isSystemFieldId распознаёт только посевные id', () => {
    expect(isSystemFieldId(CODE)).toBe(true);
    expect(isSystemFieldId(SYSTEM_FIELD_IDS.nodeCode)).toBe(true);
    expect(isSystemFieldId('not-even-a-uuid')).toBe(false);
    expect(isSystemFieldId('11111111-1111-4111-8111-111111111111')).toBe(false);
  });
});

describe('hasDuplicateSlots', () => {
  it('дубль fieldId — true, уникальные — false', () => {
    expect(
      hasDuplicateSlots([
        { fieldId: CODE, state: 'required' },
        { fieldId: CODE, state: 'optional' },
      ]),
    ).toBe(true);
    expect(
      hasDuplicateSlots([
        { fieldId: CODE, state: 'required' },
        { fieldId: CLIENT, state: 'optional' },
      ]),
    ).toBe(false);
    expect(hasDuplicateSlots([])).toBe(false);
  });
});

describe('form мест: чтение и обязательные слоты', () => {
  const form = {
    fields: [
      { fieldId: CODE, state: 'required' as const },
      { fieldId: CLIENT, state: 'optional' as const },
    ],
  };

  it('projectTypeFormOf: форма на месте — как есть, битое — умолчание', () => {
    expect(projectTypeFormOf({ form })).toEqual(form);
    expect(projectTypeFormOf({})).toEqual({ fields: [] });
    expect(projectTypeFormOf({ form: { fields: 'мусор' } })).toEqual({ fields: [] });
  });

  it('requiredProjectFields — только required-слоты', () => {
    expect(requiredProjectFields(form)).toEqual([CODE]);
  });

  it('missingProjectFields: без значения и пустой строкой — пропуск', () => {
    expect(missingProjectFields(form, {})).toEqual([CODE]);
    expect(missingProjectFields(form, { customFields: { [CODE]: 'ПР-1' } })).toEqual([]);
    expect(missingProjectFields(form, { customFields: { [CODE]: '   ' } })).toEqual([CODE]);
    expect(missingProjectFields(form, { customFields: {} })).toEqual([CODE]);
  });

  it('clearedProjectFields — обязательные, которые патч очищает', () => {
    expect(clearedProjectFields([CODE, CLIENT], { [CODE]: null, [CLIENT]: 'Акционер' })).toEqual([
      CODE,
    ]);
    expect(clearedProjectFields([CODE], { [CODE]: 'ПР-2' })).toEqual([]);
    expect(clearedProjectFields([CODE], {})).toEqual([]);
  });
});
