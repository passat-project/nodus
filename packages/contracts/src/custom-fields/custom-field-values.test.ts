import { describe, expect, it } from 'vitest';

import type { CustomFieldDefinition } from './custom-field.schemas.js';
import {
  buildValuesInputSchema,
  buildValuesPatchSchema,
  customFieldValueSchemaOf,
  isCompatibleTypeChange,
  isCustomFieldValueFilled,
  linkKindOf,
  readCustomFieldValue,
  type CustomFieldValue,
} from './custom-field-values.js';
import { customFieldIdOfKey, customFieldKey } from './custom-field-key.js';

const ID = '10000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';

function def(partial: Partial<CustomFieldDefinition> & Pick<CustomFieldDefinition, 'type'>) {
  return {
    id: ID,
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
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
    ...partial,
  } satisfies CustomFieldDefinition;
}

describe('грамматика значений полей', () => {
  it('текст: trim, без переводов строки, до 500 знаков', () => {
    const schema = customFieldValueSchemaOf(def({ type: 'text' }));
    expect(schema.safeParse('  № 12 ').data).toBe('№ 12');
    expect(schema.safeParse('две\nстроки').success).toBe(false);
    expect(schema.safeParse('   ').success).toBe(false);
    expect(schema.safeParse('я'.repeat(501)).success).toBe(false);
  });

  it('многострочный текст: переносы допустимы, до 5000', () => {
    const schema = customFieldValueSchemaOf(def({ type: 'long_text' }));
    expect(schema.safeParse('первая\nвторая').success).toBe(true);
    expect(schema.safeParse('я'.repeat(5001)).success).toBe(false);
  });

  it('число: точность из настроек, модуль ≤ 1e12', () => {
    const two = customFieldValueSchemaOf(def({ type: 'number', settings: { precision: 2 } }));
    expect(two.safeParse(12.34).success).toBe(true);
    expect(two.safeParse(12.345).success).toBe(false);
    expect(two.safeParse(1e13).success).toBe(false);
    const zero = customFieldValueSchemaOf(def({ type: 'number' }));
    expect(zero.safeParse(12.5).success).toBe(false);
  });

  it('деньги: сумма и валюта, два знака', () => {
    const schema = customFieldValueSchemaOf(
      def({ type: 'money', settings: { currencyId: OTHER } }),
    );
    expect(schema.safeParse({ amount: 100.5, currencyId: OTHER }).success).toBe(true);
    expect(schema.safeParse({ amount: 100.555, currencyId: OTHER }).success).toBe(false);
    expect(schema.safeParse({ amount: 100 }).success).toBe(false);
  });

  it('дата и дата-время — ISO', () => {
    expect(customFieldValueSchemaOf(def({ type: 'date' })).safeParse('2026-10-25').success).toBe(
      true,
    );
    expect(customFieldValueSchemaOf(def({ type: 'date' })).safeParse('25.10.2026').success).toBe(
      false,
    );
    expect(
      customFieldValueSchemaOf(def({ type: 'datetime' })).safeParse('2026-10-25T10:00:00.000Z')
        .success,
    ).toBe(true);
  });

  it('продолжительность: целые минуты 1..100000', () => {
    const schema = customFieldValueSchemaOf(def({ type: 'duration' }));
    expect(schema.safeParse(90).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(1.5).success).toBe(false);
    expect(schema.safeParse(100_001).success).toBe(false);
  });

  it('флаг хранит только true', () => {
    const schema = customFieldValueSchemaOf(def({ type: 'bool' }));
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse(false).success).toBe(false);
  });

  it('список и сотрудники: массивы без повторов до 50', () => {
    const multi = customFieldValueSchemaOf(def({ type: 'multienum' }));
    expect(multi.safeParse([ID, OTHER]).success).toBe(true);
    expect(multi.safeParse([ID, ID]).success).toBe(false);
    expect(multi.safeParse([]).success).toBe(false);
    expect(multi.safeParse(Array.from({ length: 51 }, () => crypto.randomUUID())).success).toBe(
      false,
    );
  });

  it('ссылка: http(s) или путь \\\\сервер\\ресурс, без управляющих символов', () => {
    const schema = customFieldValueSchemaOf(def({ type: 'link' }));
    expect(schema.safeParse('https://nodus.by/doc').success).toBe(true);
    expect(schema.safeParse('\\\\srv\\proekt\\КЖ').success).toBe(true);
    expect(schema.safeParse('ftp://nodus.by').success).toBe(false);
    expect(schema.safeParse('\\\\srv').success).toBe(false);
    expect(schema.safeParse('https://nodus.by/\u0001').success).toBe(false);
  });
});

describe('толерантное чтение и совместимость типов', () => {
  it('скаляр читается как массив при расширении типа', () => {
    expect(readCustomFieldValue(def({ type: 'multienum' }), ID)).toEqual([ID]);
    expect(readCustomFieldValue(def({ type: 'users' }), ID)).toEqual([ID]);
  });

  it('несовместимое хранимое значение — «не задано»', () => {
    expect(readCustomFieldValue(def({ type: 'number' }), 'abc')).toBeUndefined();
    expect(readCustomFieldValue(def({ type: 'bool' }), false)).toBeUndefined();
    expect(readCustomFieldValue(def({ type: 'date' }), null)).toBeUndefined();
  });

  it('белый список смены типа — только расширение', () => {
    expect(isCompatibleTypeChange('text', 'long_text')).toBe(true);
    expect(isCompatibleTypeChange('enum', 'multienum')).toBe(true);
    expect(isCompatibleTypeChange('user', 'users')).toBe(true);
    expect(isCompatibleTypeChange('long_text', 'text')).toBe(false);
    expect(isCompatibleTypeChange('number', 'text')).toBe(false);
    expect(isCompatibleTypeChange('date', 'date')).toBe(true);
  });

  it('«заполнено»: ноль и false — разные ответы', () => {
    expect(isCustomFieldValueFilled(0)).toBe(true);
    expect(isCustomFieldValueFilled('')).toBe(false);
    expect(isCustomFieldValueFilled([])).toBe(false);
    expect(isCustomFieldValueFilled(true)).toBe(true);
    expect(isCustomFieldValueFilled({ amount: 1, currencyId: ID })).toBe(true);
  });

  it('вид ссылки: url или путь', () => {
    expect(linkKindOf('https://nodus.by')).toBe('url');
    expect(linkKindOf('\\\\srv\\share')).toBe('path');
    expect(linkKindOf('просто текст')).toBeNull();
  });
});

describe('схемы значений по определениям (strict)', () => {
  const definitions = [
    def({ id: ID, type: 'text' }),
    def({ id: OTHER, type: 'number', settings: { precision: 0 } }),
  ];

  it('патч: null очищает, чужой ключ — ошибка', () => {
    const schema = buildValuesPatchSchema(definitions);
    expect(schema.safeParse({ [ID]: null }).success).toBe(true);
    expect(schema.safeParse({ [ID]: 'ок' }).success).toBe(true);
    expect(schema.safeParse({ [crypto.randomUUID()]: 'ок' }).success).toBe(false);
  });

  it('патч: значение проверяется по типу своего поля', () => {
    const schema = buildValuesPatchSchema(definitions);
    expect(schema.safeParse({ [OTHER]: 3.5 }).success).toBe(false);
    expect(schema.safeParse({ [OTHER]: 3 }).success).toBe(true);
  });

  it('ввод при создании не принимает null', () => {
    const schema = buildValuesInputSchema(definitions);
    expect(schema.safeParse({ [ID]: null }).success).toBe(false);
    expect(schema.safeParse({ [ID]: 'ок' }).success).toBe(true);
  });

  it('больше 50 ключей — ошибка', () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      def({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, type: 'text' }),
    );
    const values = Object.fromEntries(many.map((d) => [d.id, 'x' as CustomFieldValue]));
    expect(buildValuesInputSchema(many).safeParse(values).success).toBe(false);
  });
});

describe('ключ поля', () => {
  it('cf.<uuid>: сборка и разбор', () => {
    expect(customFieldKey(ID)).toBe(`cf.${ID}`);
    expect(customFieldIdOfKey(`cf.${ID}`)).toBe(ID);
    expect(customFieldIdOfKey('cf.not-a-uuid')).toBeNull();
    expect(customFieldIdOfKey('deadline')).toBeNull();
  });
});
