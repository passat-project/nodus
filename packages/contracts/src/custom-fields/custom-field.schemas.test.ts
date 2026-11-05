import { describe, expect, it } from 'vitest';

import {
  checkDefinitionShape,
  createCustomFieldBodySchema,
  updateCustomFieldBodySchema,
} from './custom-field.schemas.js';

const CURRENCY = '30000000-0000-4000-8000-000000000001';
const DICTIONARY = '40000000-0000-4000-8000-000000000002';

describe('форма определения поля', () => {
  it('число: точность допустима, валюта — нет', () => {
    expect(checkDefinitionShape('number', { precision: 2 }, null)).toEqual([]);
    expect(checkDefinitionShape('number', { currencyId: CURRENCY }, null)[0]?.code).toBe(
      'settings_not_allowed',
    );
    expect(checkDefinitionShape('text', { precision: 2 }, null)[0]?.code).toBe(
      'precision_not_allowed',
    );
  });

  it('деньги требуют валюту, список — справочник', () => {
    expect(checkDefinitionShape('money', {}, null)[0]?.code).toBe('currency_required');
    expect(checkDefinitionShape('money', { currencyId: CURRENCY }, null)).toEqual([]);
    expect(checkDefinitionShape('enum', {}, null)[0]?.code).toBe('dictionary_required');
    expect(checkDefinitionShape('multienum', { dictionaryId: DICTIONARY }, null)).toEqual([]);
  });

  it('«подразделение автора» — только у подразделения', () => {
    expect(checkDefinitionShape('department', {}, { kind: 'author_department' })).toEqual([]);
    expect(checkDefinitionShape('text', {}, { kind: 'author_department' })[0]?.code).toBe(
      'default_not_allowed',
    );
  });

  it('статическое умолчание проверяется типом', () => {
    expect(checkDefinitionShape('number', { precision: 0 }, { kind: 'static', value: 5 })).toEqual(
      [],
    );
    expect(
      checkDefinitionShape('number', { precision: 0 }, { kind: 'static', value: 'пять' })[0]?.code,
    ).toBe('default_invalid');
  });

  it('тело создания: strict, чужие ключи и настройки отвергаются', () => {
    expect(
      createCustomFieldBodySchema.safeParse({
        type: 'text',
        name: '  № накладной ',
      }).data?.name,
    ).toBe('№ накладной');
    expect(
      createCustomFieldBodySchema.safeParse({
        type: 'text',
        name: 'Поле',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      createCustomFieldBodySchema.safeParse({
        type: 'text',
        name: 'Поле',
        settings: { precision: 2 },
      }).success,
    ).toBe(false);
    expect(
      createCustomFieldBodySchema.safeParse({
        type: 'money',
        name: 'Сумма',
      }).success,
    ).toBe(false);
  });

  it('правка: пустое тело отвергается, справочник неизменен', () => {
    expect(updateCustomFieldBodySchema.safeParse({}).success).toBe(false);
    expect(updateCustomFieldBodySchema.safeParse({ name: 'Новое' }).success).toBe(true);
    expect(
      updateCustomFieldBodySchema.safeParse({ settings: { dictionaryId: DICTIONARY } }).success,
    ).toBe(false);
  });
});
