import { describe, expect, it } from 'vitest';
import type { UserListItem } from '@nodus/contracts';

import type { DepartmentOption } from '../../../shared/api/departments-list.js';
import { profileSubordinates } from './profile-subordinates.js';

/** «Подчинённые» карточки (#923): прямые по `managerId` + замы подразделений,
 *  которыми сотрудник руководит; один человек — одна строка, зам помечен. */

const CHIEF = 'chief';
const OTHER_CHIEF = 'other-chief';

function user(overrides: Partial<UserListItem> & { id: string }): UserListItem {
  return {
    displayName: overrides.id,
    status: 'active',
    avatarUrl: null,
    positionName: null,
    departmentName: null,
    email: `${overrides.id}@nodus.by`,
    managerId: null,
    departmentId: null,
    legalDepartmentId: null,
    positionId: null,
    legalPositionId: null,
    ...overrides,
  };
}

function department(overrides: Partial<DepartmentOption> & { id: string }): DepartmentOption {
  return {
    name: overrides.id,
    depth: 0,
    isActive: true,
    headId: null,
    deputyIds: [],
    ...overrides,
  };
}

describe('profileSubordinates (#923)', () => {
  it('прямой подчинённый по managerId — в списке', () => {
    const direct = user({ id: 'direct', managerId: CHIEF });
    const { list, deputyIds } = profileSubordinates({
      userId: CHIEF,
      users: [direct, user({ id: 'stranger', managerId: OTHER_CHIEF })],
      departments: [],
    });

    expect(list.map((item) => item.id)).toEqual(['direct']);
    expect(deputyIds.size).toBe(0);
  });

  it('зам подразделения, где сотрудник глава — в списке с меткой', () => {
    const deputy = user({ id: 'deputy' });
    const { list, deputyIds } = profileSubordinates({
      userId: CHIEF,
      users: [deputy],
      departments: [department({ id: 'd1', headId: CHIEF, deputyIds: [deputy.id] })],
    });

    expect(list.map((item) => item.id)).toEqual(['deputy']);
    expect(deputyIds.has('deputy')).toBe(true);
  });

  it('зам, который и прямой подчинённый — одна строка, первой, метка остаётся', () => {
    const direct = user({ id: 'direct', managerId: CHIEF });
    const deputy = user({ id: 'deputy', managerId: CHIEF });
    const { list, deputyIds } = profileSubordinates({
      userId: CHIEF,
      users: [direct, deputy],
      departments: [department({ id: 'd1', headId: CHIEF, deputyIds: [deputy.id] })],
    });

    expect(list.map((item) => item.id)).toEqual(['deputy', 'direct']);
    expect(deputyIds.has('deputy')).toBe(true);
  });

  it('замы идут первыми, даже если в справочнике позже (#923)', () => {
    const direct = user({ id: 'direct', managerId: CHIEF });
    const deputy = user({ id: 'deputy' });
    const { list } = profileSubordinates({
      userId: CHIEF,
      users: [direct, deputy],
      departments: [department({ id: 'd1', headId: CHIEF, deputyIds: [deputy.id] })],
    });

    expect(list.map((item) => item.id)).toEqual(['deputy', 'direct']);
  });

  it('зам отдела, где сотрудник только зам, — не включается', () => {
    const deputy = user({ id: 'deputy' });
    const { list, deputyIds } = profileSubordinates({
      userId: CHIEF,
      users: [deputy],
      departments: [department({ id: 'd1', headId: OTHER_CHIEF, deputyIds: [deputy.id] })],
    });

    expect(list).toEqual([]);
    expect(deputyIds.size).toBe(0);
  });

  it('чужой отдел: зам другого главы и его подчинённые не видны', () => {
    const { list } = profileSubordinates({
      userId: CHIEF,
      users: [
        user({ id: 'foreign-deputy' }),
        user({ id: 'foreign-member', managerId: OTHER_CHIEF }),
      ],
      departments: [department({ id: 'd1', headId: OTHER_CHIEF, deputyIds: ['foreign-deputy'] })],
    });

    expect(list).toEqual([]);
  });

  it('уволенный зам (рассинхрон данных) — не включается', () => {
    const deputy = user({ id: 'deputy', status: 'deactivated' });
    const { list, deputyIds } = profileSubordinates({
      userId: CHIEF,
      users: [deputy],
      departments: [department({ id: 'd1', headId: CHIEF, deputyIds: [deputy.id] })],
    });

    expect(list).toEqual([]);
    expect(deputyIds.size).toBe(0);
  });
});
