import { useMemo } from 'react';
import type { UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useUsersList } from '../api/users-list.js';
import type { FilterFieldDef, FilterOption } from './list-filters.js';

/** Поисковая строка сотрудника: имя + должность + отдел. */
export const employeeSearchText = (u: UserListItem) =>
  `${u.displayName} ${u.positionName ?? ''} ${u.departmentName ?? ''}`;

/** Варианты справочника из значений списка (уникальные, по алфавиту). */
function uniqueOptions(values: (string | null)[]): { value: string; label: string }[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))]
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((v) => ({ value: v, label: v }));
}

/** Руководители из загруженного списка: id → имя и аватар (person-опции). */
function managerOptions(items: readonly UserListItem[]): FilterOption[] {
  const byId = new Map(items.map((user) => [user.id, user] as const));
  const ids = new Set(
    items.map((user) => user.managerId).filter((id): id is string => Boolean(id)),
  );
  return [...ids]
    .map((id) => byId.get(id))
    .filter((user): user is UserListItem => user !== undefined)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
    .map((user) => ({ value: user.id, label: user.displayName, avatarUrl: user.avatarUrl }));
}

/**
 * Реестр фильтруемых полей сотрудников (стандарт списков): отдел, должность
 * (варианты — из загруженного списка, до справочников I15), руководитель и
 * статус (вердикт 17.11.2026). Пресетов «без руководителя/без отдела» нет.
 */
export function useEmployeeFilterDefs(): FilterFieldDef<UserListItem>[] {
  const { data } = useUsersList();

  return useMemo(() => {
    const items = data?.items ?? [];
    return [
      {
        id: 'department',
        label: ui.employees.department,
        type: 'select' as const,
        options: uniqueOptions(items.map((u) => u.departmentName)),
        match: (u: UserListItem, v) => u.departmentName === v,
      },
      {
        id: 'position',
        label: ui.employees.position,
        type: 'select' as const,
        options: uniqueOptions(items.map((u) => u.positionName)),
        match: (u: UserListItem, v) => u.positionName === v,
      },
      {
        id: 'manager',
        label: ui.employees.fieldManager,
        type: 'person' as const,
        options: managerOptions(items),
        match: (u: UserListItem, v) => u.managerId === v,
      },
      {
        id: 'status',
        label: ui.employees.fieldStatus,
        type: 'select' as const,
        options: [
          { value: 'active', label: ui.employees.statusActive },
          { value: 'deactivated', label: ui.employees.statusDeactivated },
        ],
        match: (u: UserListItem, v) => u.status === v,
      },
    ];
  }, [data]);
}
