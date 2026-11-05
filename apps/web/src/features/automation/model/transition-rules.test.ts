import { describe, expect, it } from 'vitest';

import {
  addDeciderSource,
  deciderSourcesOf,
  removeDeciderSource,
  rolesOf,
  routeIfOf,
  routeIfWhenOf,
  setAllowReview,
  setRouteIf,
  setRouteIfWhen,
  toggleField,
  toggleRole,
  toggleValidator,
  updateDeciderSource,
  validatorOf,
} from './transition-rules.js';

const base = {
  conditions: [{ kind: 'role_in' as const, roles: ['assignee' as const] }],
  validators: [],
  postFunctions: [],
};

describe('transition-rules: правки правил кнопки (#378)', () => {
  it('роли: добавить, снять; последнюю снять нельзя', () => {
    const both = toggleRole(base, 'creator');
    expect([...rolesOf(both)]).toEqual(['creator', 'assignee']);
    expect(toggleRole(base, 'assignee')).toBe(base);
  });

  it('решающие (#433): источник добавляется, обновляется и снимается', () => {
    const withPosition = addDeciderSource(base, {
      kind: 'position',
      positionId: '00000000-0000-4000-8000-000000000001',
      positionKind: 'management',
    });
    expect(deciderSourcesOf(withPosition)).toHaveLength(1);
    const withManager = addDeciderSource(withPosition, { kind: 'manager_of', of: 'creator' });
    expect(deciderSourcesOf(withManager).map((s) => s.kind)).toEqual(['position', 'manager_of']);
    const updated = updateDeciderSource(withManager, 0, {
      kind: 'position',
      positionId: '00000000-0000-4000-8000-000000000002',
      positionKind: 'legal',
    });
    expect(deciderSourcesOf(updated)[0]).toMatchObject({ positionKind: 'legal' });
    const removed = removeDeciderSource(updated, 1);
    expect(deciderSourcesOf(removed).map((s) => s.kind)).toEqual(['position']);
    // Роли сохраняются при правке источников.
    expect(rolesOf(removed).has('assignee')).toBe(true);
  });

  it('последнюю роль можно снять, если кнопку держат решающие (#433)', () => {
    const deciderOnly = addDeciderSource(base, { kind: 'manager_of', of: 'assignee' });
    const noRoles = toggleRole(deciderOnly, 'assignee');
    expect(rolesOf(noRoles).size).toBe(0);
    expect(deciderSourcesOf(noRoles)).toHaveLength(1);
  });

  it('гейт подзадач: строгий по умолчанию, галочка — мягкий', () => {
    const strict = toggleValidator(base, 'no_open_subtasks');
    expect(validatorOf(strict, 'no_open_subtasks')).toEqual({ kind: 'no_open_subtasks' });
    const soft = setAllowReview(strict, true);
    expect(validatorOf(soft, 'no_open_subtasks')).toEqual({
      kind: 'no_open_subtasks',
      allowReview: true,
    });
    expect(validatorOf(setAllowReview(soft, false), 'no_open_subtasks')).toEqual({
      kind: 'no_open_subtasks',
    });
    expect(
      validatorOf(toggleValidator(soft, 'no_open_subtasks'), 'no_open_subtasks'),
    ).toBeUndefined();
  });

  it('поля: по умолчанию описание; последнее поле не снимается', () => {
    const withFields = toggleValidator(base, 'fields_required');
    expect(validatorOf(withFields, 'fields_required')?.fields).toEqual(['description']);
    const two = toggleField(withFields, 'result');
    expect(validatorOf(two, 'fields_required')?.fields).toEqual(['description', 'result']);
    expect(toggleField(withFields, 'description')).toBe(withFields);
  });

  it('особое правило: включить с целью и выключить', () => {
    const on = setRouteIf(base, 'stage-done');
    expect(routeIfOf(on)).toBe('stage-done');
    expect(routeIfOf(setRouteIf(on, null))).toBeNull();
  });

  it('условие пропуска: новое — акторное, старое сохраняется при смене цели (#430)', () => {
    const on = setRouteIf(base, 'stage-done');
    expect(routeIfWhenOf(on)).toBe('approver_is_actor');
    const legacy = setRouteIfWhen(on, 'creator_is_assignee');
    expect(routeIfWhenOf(legacy)).toBe('creator_is_assignee');
    expect(routeIfWhenOf(setRouteIf(legacy, 'stage-other'))).toBe('creator_is_assignee');
    expect(routeIfOf(setRouteIf(legacy, 'stage-other'))).toBe('stage-other');
    expect(routeIfWhenOf(setRouteIfWhen(legacy, 'approver_is_actor'))).toBe('approver_is_actor');
  });
});

describe('поля процесса в гейте «Заполнены поля» (#431, Р7)', () => {
  const CF = '50000000-0000-4000-8000-000000000001';

  it('ключ cf.* живёт в том же массиве и снимается', () => {
    const withFields = toggleValidator(base, 'fields_required');
    const withCustom = toggleField(withFields, `cf.${CF}`);
    expect(validatorOf(withCustom, 'fields_required')?.fields).toEqual(['description', `cf.${CF}`]);
    expect(validatorOf(toggleField(withCustom, `cf.${CF}`), 'fields_required')?.fields).toEqual([
      'description',
    ]);
  });

  it('лимит условия — 20 полей (Р7)', () => {
    let rules = toggleValidator(base, 'fields_required');
    for (let index = 0; index < 19; index += 1) {
      rules = toggleField(
        rules,
        `cf.50000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      );
    }
    expect(validatorOf(rules, 'fields_required')?.fields).toHaveLength(20);
    const overflow = toggleField(rules, `cf.50000000-0000-4000-8000-000000000099`);
    expect(overflow).toEqual(rules);
  });
});
