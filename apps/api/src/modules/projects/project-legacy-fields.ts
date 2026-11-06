import type { CustomFieldValues, CustomFieldValue } from '@nodus/contracts';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';

/**
 * Шифр и заказчик проекта — системные атрибуты (Р9 #631): чтение из
 * значений атрибутов и перевод legacy-полей тела (`code`/`clientId`,
 * десктоп) в значения/патч системных атрибутов. Вынесено из
 * ProjectsService ради лимита строк файла (I5); логика прежняя.
 */

/** Шифр проекта из значений атрибутов (системный «Шифр», Р9 #631). */
export function codeOf(customFields: unknown): string | null {
  const value = attributeValue(customFields, SYSTEM_FIELD_IDS.projectCode);
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Заказчик проекта из значений атрибутов (системный «Заказчик», Р9 #631). */
export function clientOf(customFields: unknown): string | null {
  const value = attributeValue(customFields, SYSTEM_FIELD_IDS.projectClient);
  return typeof value === 'string' && value !== '' ? value : null;
}

function attributeValue(customFields: unknown, fieldId: string): unknown {
  if (customFields === null || typeof customFields !== 'object') return null;
  return (customFields as Record<string, unknown>)[fieldId] ?? null;
}

/** Legacy-поля создания → значения системных атрибутов (десктоп ещё шлёт
 *  code/clientId сверху; явное customFields важнее — Class А #631). */
export function legacyToAttributes(
  body: { code?: string; clientId?: string | null },
  customFields: CustomFieldValues,
): CustomFieldValues {
  const next = { ...customFields };
  if (body.code && next[SYSTEM_FIELD_IDS.projectCode] === undefined) {
    next[SYSTEM_FIELD_IDS.projectCode] = body.code;
  }
  if (body.clientId && next[SYSTEM_FIELD_IDS.projectClient] === undefined) {
    next[SYSTEM_FIELD_IDS.projectClient] = body.clientId;
  }
  return next;
}

/** Legacy-поля правки → патч атрибутов: null очищает (канон custom-fields). */
export function legacyPatchToAttributes(
  body: { code?: string | null; clientId?: string | null },
  customFields: Record<string, CustomFieldValue | null>,
): Record<string, CustomFieldValue | null> {
  const next = { ...customFields };
  if (body.code !== undefined && next[SYSTEM_FIELD_IDS.projectCode] === undefined) {
    next[SYSTEM_FIELD_IDS.projectCode] = body.code;
  }
  if (body.clientId !== undefined && next[SYSTEM_FIELD_IDS.projectClient] === undefined) {
    next[SYSTEM_FIELD_IDS.projectClient] = body.clientId;
  }
  return next;
}
