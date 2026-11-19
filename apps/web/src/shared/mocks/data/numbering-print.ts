import type { CustomFieldDefinition } from '@nodus/contracts';
import { numberInsertionText } from '@nodus/contracts';

import { demoCustomFieldDefinitions } from './custom-fields.js';
import { itemById } from './dictionaries.js';

/**
 * Значения полей мок-мира для нумерации (#630, #877) — ДВЕ семантики, которые
 * нельзя смешивать (находка security-ревью):
 *
 * - сырое значение (`fieldValueOf`) — идентичность условия счёта «вести счёт
 *   отдельно для значения поля»: у списка это UUID варианта (контракт
 *   `NumberContainerRef.id`);
 * - печатное (`printedFieldValueOf`, `printedCompanyValueOf`) — вставка в номер
 *   (AUD-010): код варианта, строка числа, текст как есть.
 */

/** Печатное значение по типу поля — одна грамматика контракта
 *  (`numberInsertionText`). Код списка — только из справочника ЭТОГО поля,
 *  как сервер: мёртвый или чужой вариант даёт пустую вставку. */
function printedOf(definition: CustomFieldDefinition, raw: unknown): string {
  const dictionaryId = definition.settings.dictionaryId;
  return numberInsertionText(definition.type, raw, (id) => {
    const item = itemById(id);
    if (!item || item.dictionaryId !== dictionaryId) return undefined;
    return item.code ?? item.name;
  });
}

/** Сырое значение поля по внутреннему номеру из значений записи. */
export function fieldValueOf(values: Record<string, unknown>) {
  return (fieldNumber: number): string | null => {
    const definition = demoCustomFieldDefinitions.find((entry) => entry.number === fieldNumber);
    if (!definition) return null;
    const value = values[definition.id];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
}

/** Печатное значение поля записи по внутреннему номеру. */
export function printedFieldValueOf(values: Record<string, unknown>) {
  return (fieldNumber: number): string | null => {
    const definition = demoCustomFieldDefinitions.find((entry) => entry.number === fieldNumber);
    if (!definition) return null;
    const text = printedOf(definition, values[definition.id]);
    return text.length > 0 ? text : null;
  };
}

/** Печатное значение глобальной переменной компании (источник «Компания»):
 *  значение живёт в самом определении (`companyValue`), а не в записи. */
export function printedCompanyValueOf(fieldNumber: number): string | null {
  const definition = demoCustomFieldDefinitions.find(
    (entry) => entry.number === fieldNumber && entry.isCompany,
  );
  if (!definition) return null;
  const text = printedOf(definition, definition.companyValue);
  return text.length > 0 ? text : null;
}
