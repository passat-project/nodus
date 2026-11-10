import { describe, expect, it } from 'vitest';

import type { ActionDef } from '../workflow.repository.js';
import { actionOptions } from './transition-availability.js';

/** Минимум субъекта: роль исполнителя, без обхода. */
const subject = {
  roles: new Set(['assignee']),
  permissions: [] as string[],
  bypassConditions: false,
  actsWithoutConditions: false,
  canOverrideGates: false,
  stageId: 's1',
};

function action(overrides: Partial<ActionDef>): ActionDef {
  return {
    id: 'a1',
    name: 'Замечание',
    stageId: 's1',
    display: 'button',
    sortOrder: 0,
    rules: {
      conditions: [{ kind: 'role_in', roles: ['assignee'] }],
      validators: [],
      postFunctions: [],
    },
    form: { enabled: true, sections: [] },
    steps: [],
    ...overrides,
  } as unknown as ActionDef;
}

describe('actionOptions — действия в панели карточки (#633)', () => {
  it('свои действия статуса раньше «из любого», порядок — sortOrder', () => {
    const result = actionOptions(
      {
        actions: [
          action({ id: 'any', stageId: null, sortOrder: 0 }),
          action({ id: 'b', stageId: 's1', sortOrder: 1 }),
          action({ id: 'a', stageId: 's1', sortOrder: 0 }),
        ],
      },
      subject,
    );
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b', 'any']);
  });

  it('чужой статус, недоступная роль и действие с шагами в карточку не попадают', () => {
    const result = actionOptions(
      {
        actions: [
          action({ id: 'other', stageId: 's2' }),
          action({
            id: 'role',
            rules: {
              conditions: [{ kind: 'role_in', roles: ['creator'] }],
              validators: [],
              postFunctions: [],
            },
          }),
          action({ id: 'steps', steps: [{ kind: 'assign_number' }] }),
        ],
      },
      subject,
    );
    expect(result).toEqual([]);
  });

  it('окно уходит только если включено', () => {
    const off = action({ id: 'off', form: { enabled: false, sections: [] } });
    const on = action({ id: 'on' });
    const result = actionOptions({ actions: [off, on] }, subject);
    expect(result.find((entry) => entry.id === 'off')?.form).toBeNull();
    expect(result.find((entry) => entry.id === 'on')?.form).toMatchObject({ enabled: true });
  });
});
