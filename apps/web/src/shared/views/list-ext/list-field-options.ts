import type { CustomFieldDefinition, ListEntity } from '@nodus/contracts';
import { listSystemFieldLabel } from '@nodus/contracts';

import { GROUPABLE_SYSTEM_FIELDS } from './list-ext-query.js';

/** Вариант выбора поля в панели (группировка/итог). */
export interface ListFieldOption {
  value: string;
  label: string;
}

/**
 * Поля группировки панели (#435): системные, чьё значение есть в DTO строк
 * (GROUPABLE_SYSTEM_FIELDS), и атрибуты места. Поля сортировки не
 * перечисляются — сортировка задаётся кликом по заголовку колонки.
 */
export function groupFieldOptions(
  entity: ListEntity,
  definitions: readonly CustomFieldDefinition[] | undefined,
): ListFieldOption[] {
  const system = GROUPABLE_SYSTEM_FIELDS[entity].map((field) => ({
    value: field,
    label: listSystemFieldLabel(entity, field),
  }));
  const attributes = (definitions ?? [])
    .map<ListFieldOption>((definition) => ({
      value: `cf.${definition.id}`,
      label: definition.name,
    }))
    .filter((option, index, all) => all.findIndex((o) => o.value === option.value) === index);
  return [...system, ...attributes];
}

/** Поля числовых итогов: системный «Номер» (порядковый) и числовые атрибуты
 *  (число/деньги/длительность — сервер: sum только числовые). */
export function numericFieldOptions(
  entity: ListEntity,
  definitions: readonly CustomFieldDefinition[] | undefined,
): ListFieldOption[] {
  const system: ListFieldOption[] =
    entity === 'task' ? [{ value: 'number', label: listSystemFieldLabel(entity, 'number') }] : [];
  const attributes = (definitions ?? [])
    .filter(
      (definition) =>
        definition.type === 'number' ||
        definition.type === 'money' ||
        definition.type === 'duration',
    )
    .map<ListFieldOption>((definition) => ({
      value: `cf.${definition.id}`,
      label: definition.name,
    }));
  return [...system, ...attributes];
}
