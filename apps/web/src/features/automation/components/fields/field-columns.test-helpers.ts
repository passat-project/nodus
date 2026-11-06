import type { CustomFieldDefinition } from '@nodus/contracts';

/** Общие фикстуры тестов колонок реестра атрибутов (#631):
 *  вынесено из field-columns.test.tsx (лимит строк файла). */
export const STAMP = '2026-11-01T10:00:00.000Z';

export function definition(
  id: string,
  extra: Partial<CustomFieldDefinition>,
): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type: 'text',
    name: `Атрибут ${id}`,
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
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}
