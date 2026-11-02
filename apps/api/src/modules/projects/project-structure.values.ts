import { CUSTOM_FIELD_LIMITS, type CustomFieldValues } from '@nodus/contracts';

import type { RegistryFieldChange } from '../custom-fields/ports/custom-field-registry.port.js';
import type { ProjectNodeRow } from './project-nodes.repository.js';

/** Значения папки как карта контрактов (JSONB хранит только валидную форму). */
export function valuesOf(row: ProjectNodeRow): CustomFieldValues {
  return row.customFields as CustomFieldValues;
}

/** Текст значения в событии: `long_text` обрезается до 500 (канон ADR-0029,
 *  событие не носит многокилобайтные значения). */
export function eventValue(value: RegistryFieldChange['from']): RegistryFieldChange['from'] {
  if (typeof value !== 'string' || value.length <= CUSTOM_FIELD_LIMITS.eventText) return value;
  return value.slice(0, CUSTOM_FIELD_LIMITS.eventText);
}
