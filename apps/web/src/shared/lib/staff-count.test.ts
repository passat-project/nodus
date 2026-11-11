import { describe, expect, it } from 'vitest';
import type { UserListItem } from '@nodus/contracts';

import { activeStaffCount } from './staff-count.js';

function user(status: UserListItem['status'], id: string): UserListItem {
  return {
    id,
    displayName: id,
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
  };
}

describe('activeStaffCount (#723)', () => {
  it('считает только действующих: уволенные в штат не входят', () => {
    const users = [user('active', 'a'), user('deactivated', 'b'), user('active', 'c')];
    expect(activeStaffCount(users)).toBe(2);
  });

  it('пустой справочник — ноль, а не «весь список»', () => {
    expect(activeStaffCount([])).toBe(0);
  });
});
