import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { CustomFieldDefinition, CustomFieldModule, CustomFieldValues } from '@nodus/contracts';
import {
  customFieldKey,
  isCustomFieldValueFilled,
  readCustomFieldValue,
  ui,
} from '@nodus/contracts';

import { useDepartmentsList } from '../api/departments-list.js';
import { projectsAvailable } from '../api/projects-available.js';
import { useProjectsList } from '../api/projects-list.js';
import { useUsersList } from '../api/users-list.js';
import { dictionariesKeys, fetchDictionaryItems } from '../dictionaries/queries.js';
import type { FilterFieldDef, FilterOption } from '../views/list-filters.js';
import { useCustomFieldDefinitions } from './queries.js';

/**
 * Фильтры по атрибутам (#431/#631) — в группе «Атрибуты» панели фильтра:
 * «содержит» для текстов и ссылок, диапазоны чисел/денег/продолжительности/
 * дат, выбор для списков и подразделений, сотрудник. Клиентские, по
 * загруженным страницам — как все фильтры списков (О4); серверные
 * `filter[cf.<id>]` — #435. Группа строится из атрибутов, привязанных
 * к модулю (module=task/letter/project/node) — список уже отфильтрован
 * сервером по привязкам.
 */
export function useCustomFieldFilterDefs<T>(
  module: Exclude<CustomFieldModule, 'company'>,
  valuesOf: (item: T) => CustomFieldValues,
): FilterFieldDef<T>[] {
  const { data } = useCustomFieldDefinitions(module);
  const definitions = useMemo(() => data ?? [], [data]);
  const { data: users } = useUsersList();
  const departments = useDepartmentsList();
  const projectsAvailableNow = projectsAvailable();
  const { data: projects } = useProjectsList({ enabled: projectsAvailableNow });
  const dictionaryCodes = useMemo(
    () =>
      [
        ...new Set(
          definitions
            .map((definition) => definition.dictionary?.code)
            .filter((code): code is string => typeof code === 'string'),
        ),
      ].sort(),
    [definitions],
  );
  const dictionaryQueries = useQueries({
    queries: dictionaryCodes.map((code) => ({
      queryKey: dictionariesKeys.items(code, false),
      queryFn: () => fetchDictionaryItems(code, false),
      staleTime: 60_000,
    })),
  });
  const itemsByCode = useMemo(() => {
    const map = new Map<string, FilterOption[]>();
    dictionaryCodes.forEach((code, index) => {
      map.set(
        code,
        (dictionaryQueries[index]?.data ?? [])
          .filter((item) => item.isActive)
          .map((item) => ({ value: item.id, label: item.name })),
      );
    });
    return map;
  }, [dictionaryCodes, dictionaryQueries]);

  return useMemo(
    () =>
      definitions.flatMap((definition) =>
        customFieldFilterDef(
          definition,
          valuesOf,
          itemsByCode.get(definition.dictionary?.code ?? '') ?? [],
          (users?.items ?? []).map((user) => ({
            value: user.id,
            label: user.displayName,
            avatarUrl: user.avatarUrl,
          })),
          departments.map((department) => ({ value: department.id, label: department.name })),
          projectsAvailableNow
            ? (projects?.items ?? []).map((project) => ({
                value: project.id,
                label: project.name,
              }))
            : [],
        ),
      ),
    [definitions, valuesOf, itemsByCode, users, departments, projects, projectsAvailableNow],
  );
}

/** Сравнение диапазона: пустые границы не ограничивают. */
function inRange(value: number | undefined, range: { from?: number; to?: number }): boolean {
  if (value === undefined) return false;
  if (range.from !== undefined && value < range.from) return false;
  if (range.to !== undefined && value > range.to) return false;
  return true;
}

function numericOf(definition: CustomFieldDefinition, raw: unknown): number | undefined {
  if (definition.type === 'money') {
    const money = raw as { amount?: unknown } | undefined;
    return typeof money?.amount === 'number' ? money.amount : undefined;
  }
  return typeof raw === 'number' ? raw : undefined;
}

export function customFieldFilterDef<T>(
  definition: CustomFieldDefinition,
  valuesOf: (item: T) => CustomFieldValues,
  dictionaryOptions: FilterOption[],
  userOptions: FilterOption[],
  departmentOptions: FilterOption[],
  projectOptions: FilterOption[],
): FilterFieldDef<T>[] {
  const read = (item: T) => readCustomFieldValue(definition, valuesOf(item)[definition.id]);
  const base = {
    id: customFieldKey(definition.id),
    label: definition.name,
    group: ui.filters.groupFields,
  };

  switch (definition.type) {
    case 'text':
    case 'long_text':
    case 'link':
      return [
        {
          ...base,
          type: 'text',
          match: (item, value) => {
            const raw = read(item);
            const q = typeof value === 'string' ? value.trim().toLowerCase() : '';
            return (
              q === '' ||
              String(raw ?? '')
                .toLowerCase()
                .includes(q)
            );
          },
        },
      ];
    case 'number':
    case 'money':
    case 'duration':
      return [
        {
          ...base,
          type: 'numberRange',
          ...(definition.type === 'duration' ? { numberFormat: 'duration' as const } : {}),
          match: (item, value) =>
            typeof value === 'object' && value !== undefined
              ? inRange(numericOf(definition, read(item)), value as { from?: number; to?: number })
              : true,
        },
      ];
    case 'date':
    case 'datetime':
      return [
        {
          ...base,
          type: 'dateRange',
          match: (item, value) => {
            if (typeof value !== 'object' || value === undefined) return true;
            const raw = read(item);
            if (typeof raw !== 'string') return false;
            const day = raw.slice(0, 10);
            if (value.from && day < value.from) return false;
            if (value.to && day > value.to) return false;
            return true;
          },
        },
      ];
    case 'bool':
      return [
        {
          ...base,
          type: 'select',
          options: [
            { value: 'true', label: ui.customFields.value.yes },
            { value: 'false', label: ui.customFields.value.no },
          ],
          match: (item, value) => {
            if (typeof value !== 'string') return true;
            const filled = isCustomFieldValueFilled(read(item));
            return value === 'true' ? filled : !filled;
          },
        },
      ];
    case 'enum':
      return [
        {
          ...base,
          type: 'select',
          options: dictionaryOptions,
          match: (item, value) => (typeof value === 'string' ? read(item) === value : true),
        },
      ];
    case 'multienum':
      return [
        {
          ...base,
          type: 'select',
          options: dictionaryOptions,
          match: (item, value) => {
            if (typeof value !== 'string') return true;
            const raw = read(item);
            return Array.isArray(raw) && raw.includes(value);
          },
        },
      ];
    case 'user':
    case 'users':
      return [
        {
          ...base,
          type: 'person',
          options: userOptions,
          match: (item, value) => {
            if (typeof value !== 'string') return true;
            const raw = read(item);
            return Array.isArray(raw) ? raw.includes(value) : raw === value;
          },
        },
      ];
    case 'department':
      return [
        {
          ...base,
          type: 'select',
          options: departmentOptions,
          match: (item, value) => (typeof value === 'string' ? read(item) === value : true),
        },
      ];
    case 'project':
      if (projectOptions.length === 0) return [];
      return [
        {
          ...base,
          type: 'select',
          options: projectOptions,
          match: (item, value) => (typeof value === 'string' ? read(item) === value : true),
        },
      ];
    // Ссылки на записи (задача/письмо/папка) и «Контрагент» — фильтра нет
    // до #435; «Проект» без модуля — пустой список вариантов, поле не
    // появляется.
    case 'counterparty':
    case 'task':
    case 'letter':
    case 'node':
      return [];
  }
}
