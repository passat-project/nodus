import { describe, expect, it } from 'vitest';
import { Permission } from '@nodus/contracts';

import { visibleTasksWhere, ViewerResolver } from './task-visibility.js';

const viewer = {
  id: 'me',
  permissions: [] as string[],
  subordinateIds: [] as string[],
  visibleProjectIds: [] as string[],
  hiddenProjectIds: [] as string[],
};

describe('visibleTasksWhere (#37 + #52 Р3)', () => {
  it('ViewerResolver собирает подчинённых, проекты, решающих и участников сбора (#434)', async () => {
    const resolver = new ViewerResolver(
      { subordinateIds: async () => ['sub'] } as never,
      { viewScopeFor: async () => ({ visibleProjectIds: ['p1'], hiddenProjectIds: [] }) } as never,
      { taskIdsFor: async () => ['d1'] } as never,
      { waitingTaskIds: async () => ['press1'] } as never,
    );
    await expect(resolver.resolve({ id: 'me', permissions: [] })).resolves.toMatchObject({
      subordinateIds: ['sub'],
      visibleProjectIds: ['p1'],
      deciderTaskIds: ['d1'],
      pressTaskIds: ['press1'],
    });
  });
  it('mine — только собственное участие, удалённые скрыты', () => {
    const where = visibleTasksWhere({ ...viewer, subordinateIds: ['sub'] }, 'mine');
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toHaveLength(3);
    expect(JSON.stringify(where)).not.toContain('sub');
    // проекты не расширяют mine: свой срез — только личное участие
    expect(JSON.stringify(where)).not.toContain('projectId');
  });

  it('all — своё участие (гейтнутое), подчинённые и видимые проекты', () => {
    const where = visibleTasksWhere(
      { ...viewer, subordinateIds: ['sub'], visibleProjectIds: ['p-1'] },
      'all',
    );
    expect(where.OR).toHaveLength(3);
    expect(JSON.stringify(where)).toContain('"in"');
  });

  it('подчинённые не раскрывают секретные проекты: ветка гейтится скрытыми', () => {
    const where = visibleTasksWhere(
      { ...viewer, subordinateIds: ['sub'], hiddenProjectIds: ['secret-1'] },
      'all',
    );
    // [0] — моё участие (тоже гейтнуто), [1] — подчинённые
    const subordinateBranch = where.OR![1] as { AND: unknown[] };
    expect(subordinateBranch.AND).toHaveLength(3); // involves + конфиденциальные + гейт
    const gate = subordinateBranch.AND[2] as { OR: unknown[] };
    // NULL-ветка обязательна: NULL NOT IN прячет задачи без проекта (Р3)
    expect(gate.OR[0]).toEqual({ projectId: null });
    expect(gate.OR[1]).toEqual({ projectId: { notIn: ['secret-1'] } });
  });

  it('без скрытых проектов ветка подчинённых — без проектного гейта (как до Р3)', () => {
    const where = visibleTasksWhere({ ...viewer, subordinateIds: ['sub'] }, 'all');
    const subordinateBranch = where.OR![1] as { AND: unknown[] };
    // Конфиденциальные (#461) гейтятся всегда: involves + confidential=false.
    expect(subordinateBranch.AND).toEqual([{ OR: expect.any(Array) }, { confidential: false }]);
    expect((subordinateBranch.AND[0] as { OR: unknown[] }).OR).toHaveLength(3);
  });

  it('task.view_all — все живые задачи, кроме конфиденциальных и скрытых проектов', () => {
    const viewAll = { ...viewer, permissions: [Permission.TASK_VIEW_ALL] };
    // Скрытых нет — весь фонд; СВОЁ участие отдельной веткой (участник видит
    // свою конфиденциальную задачу и с правом «все задачи» — #461, Р5).
    const all = visibleTasksWhere(viewAll, 'all');
    expect(all.deletedAt).toBeNull();
    expect(all.OR).toHaveLength(2);
    expect(all.OR![1]).toEqual({ confidential: false });
    // скрытые есть — гейты остаются и у админа (не ранний return)
    const hidden = visibleTasksWhere({ ...viewAll, hiddenProjectIds: ['secret-1'] }, 'all');
    expect(hidden.OR![1]).toEqual({
      AND: [
        { OR: [{ projectId: null }, { projectId: { notIn: ['secret-1'] } }] },
        { confidential: false },
      ],
    });
    // mine — по-прежнему только своё (свои конфиденциальные видны)
    expect(visibleTasksWhere(viewAll, 'mine').OR).toHaveLength(3);
    expect(JSON.stringify(visibleTasksWhere(viewAll, 'mine'))).not.toContain('confidential');
  });

  it('видимые проекты не раскрывают конфиденциальные задачи проекта (#461, Р5)', () => {
    const where = visibleTasksWhere({ ...viewer, visibleProjectIds: ['p-1'] }, 'all');
    const projectBranch = where.OR![1] as { AND: unknown[] };
    expect(projectBranch.AND).toEqual([{ projectId: { in: ['p-1'] } }, { confidential: false }]);
  });

  it('без прав, подчинённых и проектов all = mine (гейт-обёртка)', () => {
    const where = visibleTasksWhere(viewer, 'all');
    expect(where.OR).toHaveLength(1);
    expect((where.OR![0] as { OR: unknown[] }).OR).toHaveLength(3);
  });

  it('решающий (#433): ветка под гейтом секретных и конфиденциальных', () => {
    const where = visibleTasksWhere(
      { ...viewer, deciderTaskIds: ['t-1'], hiddenProjectIds: ['secret-1'] },
      'all',
    );
    const branch = where.OR!.at(-1) as { AND: unknown[] };
    expect(branch.AND[0]).toEqual({ id: { in: ['t-1'] } });
    expect(branch.AND[1]).toEqual({ confidential: false });
    expect(branch.AND[2]).toMatchObject({
      OR: [{ projectId: null }, { projectId: { notIn: ['secret-1'] } }],
    });
  });

  it('решающий не расширяет scope=mine (пресет запрашивает all)', () => {
    const where = visibleTasksWhere({ ...viewer, deciderTaskIds: ['t-1'] }, 'mine');
    expect(JSON.stringify(where)).not.toContain('t-1');
  });

  it('task.view_all сохраняет ветку решающего', () => {
    const where = visibleTasksWhere(
      { ...viewer, permissions: [Permission.TASK_VIEW_ALL], deciderTaskIds: ['t-1'] },
      'all',
    );
    expect(where.OR).toHaveLength(3);
    expect(JSON.stringify(where.OR)).toContain('t-1');
  });
});
