import { describe, expect, it, vi } from 'vitest';

import { DepartmentsService } from './departments.service.js';

/** Счётчик состава юрлица (#843): юрлица связаны через legalDepartmentId —
 *  include обязан брать legalMembers, иначе в дереве всегда 0. */

function legalRow(members: number, legalMembers: number) {
  return {
    id: 'legal',
    name: 'ООО «Ромашка»',
    kind: 'legal',
    parentId: null,
    headId: null,
    deputyIds: [],
    sortOrder: 0,
    isActive: true,
    head: null,
    deputy: null,
    _count: { members, legalMembers },
  };
}

describe('DepartmentsService: memberCount юрлица', () => {
  it('считает legalMembers, а не управленческий состав', async () => {
    const departments = { findAllByKind: vi.fn().mockResolvedValue([legalRow(7, 3)]) };
    const service = new DepartmentsService(
      departments as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const tree = await service.getTree('legal');

    expect(tree[0]!.memberCount).toBe(3);
  });
});
