// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useEmployeeFilterDefs } from './employee-filter-fields.js';

/**
 * Реестр фильтров журнала сотрудников (#768, вердикт 17.11.2026): отдел,
 * должность, руководитель (person) и статус. Пресетов «без руководителя/без
 * отдела» нет — это принятая слепая зона.
 */

const person = (
  id: string,
  name: string,
  status: UserListItem['status'],
  overrides: Partial<UserListItem> = {},
): UserListItem => ({
  id,
  displayName: name,
  status,
  avatarUrl: null,
  positionName: null,
  departmentName: null,
  email: `${id}@test.local`,
  managerId: null,
  departmentId: null,
  legalDepartmentId: null,
  positionId: null,
  legalPositionId: null,
  ...overrides,
});

const items: UserListItem[] = [
  person('u-1', 'Иванов Иван', 'active', {
    managerId: 'u-3',
    departmentName: 'Проектный отдел',
    positionName: 'ГИП',
  }),
  person('u-2', 'Петров Пётр', 'deactivated', {
    managerId: 'u-3',
    departmentName: 'Проектный отдел',
  }),
  person('u-3', 'Сидоров Сидор', 'active', {
    departmentName: 'BIM-отдел',
    avatarUrl: '/a/u-3.webp',
  }),
];

vi.mock('../api/users-list.js', () => ({
  useUsersList: () => ({ data: { items, nextCursor: null } }),
}));

function defs() {
  return renderHook(() => useEmployeeFilterDefs()).result.current;
}

describe('useEmployeeFilterDefs (#768)', () => {
  it('поля: отдел, должность, руководитель, статус', () => {
    expect(defs().map((def) => def.id)).toEqual(['department', 'position', 'manager', 'status']);
    expect(defs().find((def) => def.id === 'department')?.label).toBe(ui.employees.department);
    expect(defs().find((def) => def.id === 'department')?.label).toBe('Отдел');
  });

  it('руководитель — person-опции из уникальных managerId, без «без руководителя»', () => {
    const manager = defs().find((def) => def.id === 'manager')!;

    expect(manager.type).toBe('person');
    expect(manager.options).toEqual([
      { value: 'u-3', label: 'Сидоров Сидор', avatarUrl: '/a/u-3.webp' },
    ]);
    expect(manager.match(items[0]!, 'u-3')).toBe(true);
    expect(manager.match(items[2]!, 'u-3')).toBe(false);
  });

  it('статус: работает/уволен', () => {
    const status = defs().find((def) => def.id === 'status')!;

    expect(status.options).toEqual([
      { value: 'active', label: ui.employees.statusActive },
      { value: 'deactivated', label: ui.employees.statusDeactivated },
    ]);
    expect(status.match(items[0]!, 'active')).toBe(true);
    expect(status.match(items[1]!, 'active')).toBe(false);
    expect(status.match(items[1]!, 'deactivated')).toBe(true);
  });

  it('отдел фильтрует по имени отдела', () => {
    const department = defs().find((def) => def.id === 'department')!;

    expect(department.options?.map((option) => option.label)).toEqual([
      // localeCompare('ru'): кириллица раньше латиницы — «BIM-отдел» ниже.
      'Проектный отдел',
      'BIM-отдел',
    ]);
    expect(department.match(items[0]!, 'Проектный отдел')).toBe(true);
  });
});
