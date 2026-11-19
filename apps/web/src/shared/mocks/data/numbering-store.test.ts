import { describe, expect, it } from 'vitest';

import { demoCustomFieldDefinitions } from './custom-fields.js';
import { dictionaryById, itemsOf } from './dictionaries.js';
import { fieldValueOf, printedCompanyValueOf, printedFieldValueOf } from './numbering-store.js';

/**
 * Две семантики значения поля в мок-мире (#877, AUD-010; находка
 * security-ревью): id условия счёта «значение поля» — сырое значение (UUID
 * варианта списка, контракт `NumberContainerRef.id`), печать в номер — код
 * варианта. Одна функция на оба случая ломала бы счета и контракт ответа.
 */
describe('numbering-store: сырое и печатное значение поля', () => {
  it('список: id условия счёта — UUID варианта, печать — код', () => {
    const definition = demoCustomFieldDefinitions.find((entry) => {
      if (entry.type !== 'enum' || typeof entry.settings.dictionaryId !== 'string') return false;
      const dictionary = dictionaryById(entry.settings.dictionaryId);
      return dictionary !== undefined && itemsOf(dictionary.code).length > 0;
    });
    expect(definition, 'в демо-мире есть заполненный список').toBeDefined();
    const dictionary = dictionaryById(definition!.settings.dictionaryId as string)!;
    const item = itemsOf(dictionary.code)[0]!;

    const values = { [definition!.id]: item.id };
    expect(fieldValueOf(values)(definition!.number)).toBe(item.id);
    expect(printedFieldValueOf(values)(definition!.number)).toBe(item.code ?? item.name);
  });

  it('число печатается строкой (сырое значение условия — только строка)', () => {
    const definition = demoCustomFieldDefinitions.find((entry) => entry.type === 'number');
    if (!definition) return;
    const values = { [definition.id]: 12 };
    expect(fieldValueOf(values)(definition.number)).toBeNull();
    expect(printedFieldValueOf(values)(definition.number)).toBe('12');
  });

  it('неподдержанный тип не печатается, но сырое значение условия сохраняется', () => {
    const definition = demoCustomFieldDefinitions.find(
      (entry) => entry.type === 'money' || entry.type === 'date' || entry.type === 'link',
    );
    expect(definition, 'в демо-мире есть поле без печатного вида').toBeDefined();
    const values = { [definition!.id]: '2026-11-19' };
    expect(fieldValueOf(values)(definition!.number)).toBe('2026-11-19');
    expect(printedFieldValueOf(values)(definition!.number)).toBeNull();
  });

  it('источник «Компания» печатает значение переменной, а не пусто', () => {
    const definition = demoCustomFieldDefinitions.find(
      (entry) => entry.isCompany && entry.type === 'number' && entry.companyValue !== null,
    );
    expect(definition, 'в демо-мире есть числовая переменная компании').toBeDefined();
    expect(printedCompanyValueOf(definition!.number)).toBe(String(definition!.companyValue));
  });
});
