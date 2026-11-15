import type { CustomFieldKey, DeciderSource } from '@nodus/contracts';

/**
 * Источник по умолчанию при добавлении в редакторе (#433): вынесено из
 * компонента, чтобы правила «что подставить» были чистым и тестируемым кодом.
 * `null` — добавлять нечего (нет user-полей): кнопка добавления остаётся, но
 * пустой источник в документ не попадает.
 */
export function defaultDeciderSource(
  kind: DeciderSource['kind'],
  userFieldIds: readonly string[],
): DeciderSource | null {
  switch (kind) {
    case 'manager_of':
      return { kind: 'manager_of', of: 'creator' };
    case 'employees':
      return { kind: 'employees', userIds: [] };
    case 'field': {
      const fieldId = userFieldIds[0];
      return fieldId ? { kind: 'field', field: `cf.${fieldId}` as CustomFieldKey } : null;
    }
    case 'project_role':
      return { kind: 'project_role', role: 'manager' };
  }
}
