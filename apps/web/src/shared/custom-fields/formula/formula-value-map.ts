import type { CustomFieldDefinition, CustomFieldValue, MoneyValue } from '@nodus/contracts';
import type { FormulaValue } from '@nodus/formula-engine';

import { itemById } from '../../mocks/data/dictionaries.js';

/** Значение атрибута в языке формул (#632, Р7): перечисления — КОД варианта
 *  (короткая марка «КЖ»; без кода — подпись), списки — массив кодов,
 *  ссылки — id. */
const EMPTY_DASH = /^[\s\u2010-\u2015\u2212-]+$/;

export function toFormulaValue(
  definition: CustomFieldDefinition,
  value: CustomFieldValue,
): FormulaValue {
  switch (definition.type) {
    case 'enum': {
      const item = itemById(String(value));
      const text = item ? (item.code ?? item.name) : String(value);
      return EMPTY_DASH.test(text) ? null : text;
    }
    case 'multienum':
    case 'users': {
      const ids = Array.isArray(value) ? value : [String(value)];
      return ids.map((id) => {
        const item = itemById(id);
        return item ? (item.code ?? item.name) : id;
      });
    }
    case 'money':
      return value as MoneyValue;
    case 'bool':
      return Boolean(value);
    case 'number':
    case 'duration':
      return typeof value === 'number' ? value : Number(value);
    default: {
      const text = String(value);
      return EMPTY_DASH.test(text) ? null : text;
    }
  }
}
