import { describe, expect, it } from 'vitest';

import {
  deciderPositionKey,
  deciderSourceSchema,
  matchesDecider,
  type WorkflowDeciderFacts,
} from './decider.js';
import { workflowConditionSchema } from './workflow.schemas.js';

/** Полный набор фактов: без него тест проверяет не то, что кажется. */
function facts(patch: Partial<WorkflowDeciderFacts> = {}): WorkflowDeciderFacts {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    creatorManagerId: null,
    assigneeManagerId: null,
    positionKeys: new Set(),
    projectRole: null,
    fieldUserIds: {},
    userFieldIds: new Set(),
    ...patch,
  };
}

const POSITION_ID = '22222222-2222-4222-8222-222222222222';
const FIELD_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';

describe('matchesDecider (#433)', () => {
  it('должность: совпадает только свой вид и id', () => {
    const f = facts({ positionKeys: new Set([deciderPositionKey('management', POSITION_ID)]) });
    expect(
      matchesDecider({ kind: 'position', positionId: POSITION_ID, positionKind: 'management' }, f),
    ).toBe(true);
    expect(
      matchesDecider({ kind: 'position', positionId: POSITION_ID, positionKind: 'legal' }, f),
    ).toBe(false);
    expect(
      matchesDecider({ kind: 'position', positionId: OTHER_ID, positionKind: 'management' }, f),
    ).toBe(false);
  });

  it('руководитель: только ближайший, выше по цепочке — нет', () => {
    const f = facts({ creatorManagerId: POSITION_ID });
    expect(matchesDecider({ kind: 'manager_of', of: 'creator' }, f)).toBe(false);
    const own = facts({
      userId: POSITION_ID,
      creatorManagerId: POSITION_ID,
      assigneeManagerId: OTHER_ID,
    });
    expect(matchesDecider({ kind: 'manager_of', of: 'creator' }, own)).toBe(true);
    expect(matchesDecider({ kind: 'manager_of', of: 'assignee' }, own)).toBe(false);
  });

  it('руководителя нет — источник не совпадает', () => {
    expect(matchesDecider({ kind: 'manager_of', of: 'creator' }, facts())).toBe(false);
  });

  it('конкретные сотрудники', () => {
    const f = facts();
    expect(matchesDecider({ kind: 'employees', userIds: [f.userId] }, f)).toBe(true);
    expect(matchesDecider({ kind: 'employees', userIds: [OTHER_ID] }, f)).toBe(false);
  });

  it('поле «Сотрудник(и)»: только user-поле и только своё значение', () => {
    const f = facts({
      userFieldIds: new Set([FIELD_ID]),
      fieldUserIds: { [FIELD_ID]: [OTHER_ID] },
    });
    expect(matchesDecider({ kind: 'field', field: `cf.${FIELD_ID}` }, f)).toBe(false);
    const own = facts({
      userFieldIds: new Set([FIELD_ID]),
      fieldUserIds: { [FIELD_ID]: [ownId()] },
    });
    expect(matchesDecider({ kind: 'field', field: `cf.${FIELD_ID}` }, own)).toBe(true);
    // Поле A не должно путаться с полем B.
    expect(matchesDecider({ kind: 'field', field: `cf.${OTHER_ID}` }, own)).toBe(false);
    // Не user-поле источником не является.
    expect(
      matchesDecider(
        { kind: 'field', field: `cf.${FIELD_ID}` },
        facts({ fieldUserIds: { [FIELD_ID]: [ownId()] } }),
      ),
    ).toBe(false);
  });

  it('роль в проекте', () => {
    expect(
      matchesDecider({ kind: 'project_role', role: 'manager' }, facts({ projectRole: 'manager' })),
    ).toBe(true);
    expect(
      matchesDecider({ kind: 'project_role', role: 'observer' }, facts({ projectRole: 'manager' })),
    ).toBe(false);
    expect(matchesDecider({ kind: 'project_role', role: 'observer' }, facts())).toBe(false);
  });
});

function ownId(): string {
  return '11111111-1111-4111-8111-111111111111';
}

describe('deciderSourceSchema / workflowConditionSchema (#433)', () => {
  it('старый документ без decider_in остаётся валидным', () => {
    expect(workflowConditionSchema.parse({ kind: 'role_in', roles: ['creator'] })).toEqual({
      kind: 'role_in',
      roles: ['creator'],
    });
    expect(
      workflowConditionSchema.parse({ kind: 'permission', permission: 'task.manage_any' }),
    ).toEqual({ kind: 'permission', permission: 'task.manage_any' });
  });

  it('каждый источник проходит схему', () => {
    const sources = [
      { kind: 'position', positionId: POSITION_ID, positionKind: 'legal' },
      { kind: 'manager_of', of: 'assignee' },
      { kind: 'employees', userIds: [OTHER_ID] },
      { kind: 'field', field: `cf.${FIELD_ID}` },
      { kind: 'project_role', role: 'participant' },
    ];
    for (const source of sources) {
      expect(deciderSourceSchema.parse(source)).toBeTruthy();
      expect(workflowConditionSchema.parse({ kind: 'decider_in', source })).toBeTruthy();
    }
  });

  it('невалидные источники отсекаются', () => {
    expect(deciderSourceSchema.safeParse({ kind: 'employees', userIds: [] }).success).toBe(false);
    expect(
      deciderSourceSchema.safeParse({
        kind: 'position',
        positionId: 'not-uuid',
        positionKind: 'management',
      }).success,
    ).toBe(false);
    expect(deciderSourceSchema.safeParse({ kind: 'field', field: 'description' }).success).toBe(
      false,
    );
    expect(deciderSourceSchema.safeParse({ kind: 'project_role', role: 'owner' }).success).toBe(
      false,
    );
  });
});
