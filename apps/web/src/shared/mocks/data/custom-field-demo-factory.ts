import type {
  CustomFieldBindings,
  CustomFieldDefinition,
  CustomFieldSettings,
  CustomFieldType,
} from '@nodus/contracts';

import { currencyIds, dictionaryByCode } from './dictionaries.js';
import { reserveFieldNumber, takeFieldNumber } from './field-sequence.js';

/** Фабрика демо-определений атрибутов (#631/#632): форма DTO, номер из
 *  sequence (явный номер резервируется для формул), ссылка на справочник.
 *  Вынесена из `custom-fields.ts` (I5) — данные посева остаются данными. */

export const STAMP = '2026-10-20T09:00:00.000Z';

export function definition(
  id: string,
  type: CustomFieldType,
  name: string,
  bindings: Partial<CustomFieldBindings>,
  extra: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  // Явный номер (#632): формулы адресуют атрибуты номером, и номер демо-
  // атрибута в формуле должен совпадать с посевом. Sequence не откатывается:
  // следующий созданный атрибут получит номер после явного.
  const number = extra.number ?? takeFieldNumber();
  if (extra.number !== undefined) reserveFieldNumber(extra.number);
  return {
    id,
    number,
    type,
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: {
      processTypeIds: bindings.processTypeIds ?? [],
      projectTypeIds: bindings.projectTypeIds ?? [],
      nodeKindIds: bindings.nodeKindIds ?? [],
    },
    sortOrder: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

export function dictionaryRef(code: string) {
  const dictionary = dictionaryByCode(code);
  return dictionary
    ? {
        id: dictionary.id,
        code: dictionary.code,
        name: dictionary.name,
        isSystem: dictionary.isSystem,
      }
    : null;
}

export const moneySettings: CustomFieldSettings = { currencyId: currencyIds.byn };
