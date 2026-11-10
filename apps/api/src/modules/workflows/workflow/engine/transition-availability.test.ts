import { describe, expect, it } from 'vitest';
import type { WorkflowTransitionRules } from '@nodus/contracts';

import { canShow } from './transition-availability.js';

const rules: WorkflowTransitionRules = {
  conditions: [{ kind: 'role_in', roles: ['assignee'] }],
  validators: [],
  postFunctions: [],
};

const subject = (overrides: Record<string, unknown> = {}) => ({
  roles: new Set<string>(),
  permissions: [],
  bypassConditions: false,
  actsWithoutConditions: false,
  canOverrideGates: false,
  ...overrides,
});

describe('canShow — коллективная кнопка (#434)', () => {
  it('обычные условия не пропускают соисполнителя', () => {
    expect(canShow({ id: 'tr1', rules }, subject())).toBe(false);
  });

  it('участник сбора видит кнопку независимо от условий «кто»', () => {
    expect(canShow({ id: 'tr1', rules }, subject({ pressTransitionIds: new Set(['tr1']) }))).toBe(
      true,
    );
  });
});
