import { describe, expect, it } from 'vitest';
import type { Position, UserListItem } from '@nodus/contracts';

import { computeDataCheck } from './data-check.js';

function user(overrides: Partial<UserListItem> & { id: string }): UserListItem {
  return {
    displayName: overrides.id,
    status: 'active',
    avatarUrl: null,
    positionName: null,
    departmentName: null,
    email: `${overrides.id}@test.local`,
    managerId: null,
    departmentId: null,
    legalDepartmentId: null,
    positionId: null,
    legalPositionId: null,
    ...overrides,
  };
}

function position(id: string, kind: 'management' | 'legal' = 'management'): Position {
  return { id, name: id, kind, sortOrder: 0, isActive: true };
}

describe('computeDataCheck (#441)', () => {
  it('находит должности без активных держателей (обе структуры)', () => {
    const result = computeDataCheck(
      [user({ id: 'a', positionId: 'p1', managerId: 'm', departmentId: 'd' })],
      [position('p1'), position('p2'), position('p3', 'legal')],
    );

    expect(result.positionsWithoutEmployees.map((entry) => entry.id)).toEqual(['p2', 'p3']);
  });

  it('держатель юридической должности закрывает её', () => {
    const result = computeDataCheck(
      [user({ id: 'a', legalPositionId: 'p3', managerId: 'm', departmentId: 'd' })],
      [position('p3', 'legal')],
    );

    expect(result.positionsWithoutEmployees).toEqual([]);
  });

  it('без руководителя и без подразделения — только активные сотрудники', () => {
    const result = computeDataCheck(
      [
        user({ id: 'a', managerId: 'm', departmentId: 'd' }),
        user({ id: 'b' }),
        user({ id: 'c', status: 'deactivated' }),
      ],
      [],
    );

    expect(result.withoutManager.map((entry) => entry.id)).toEqual(['b']);
    expect(result.withoutDepartment.map((entry) => entry.id)).toEqual(['b']);
  });
});
