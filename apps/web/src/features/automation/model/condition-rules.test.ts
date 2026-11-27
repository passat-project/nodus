import { describe, expect, it } from 'vitest';

import {
  addCondition,
  addPredicate,
  addValidator,
  emptyConditionQuery,
  newFormulaValidator,
  newRecordsValidator,
  removeConditionAt,
  removePredicateAt,
  removeValidatorAt,
  setQuantifier,
  updateConditionAt,
  updateValidatorAt,
  withOverridePolicy,
  withSubject,
  asyncRulesOf,
} from './condition-rules.js';
import type { Rules } from './transition-rules.js';

const base: Rules = {
  conditions: [{ kind: 'role_in', roles: ['assignee'] }],
  validators: [{ kind: 'no_open_subtasks' }],
  postFunctions: [],
};

describe('condition-rules: правила общей выборки кнопки (#635)', () => {
  it('условие records добавляется, правится и снимается, не трогая роли', () => {
    const withCondition = addCondition(base, {
      kind: 'records',
      query: emptyConditionQuery(),
    });
    expect(withCondition.conditions).toHaveLength(2);
    expect(withCondition.conditions[0]).toEqual({ kind: 'role_in', roles: ['assignee'] });

    const changed = updateConditionAt(withCondition, 0, {
      kind: 'records',
      query: { ...emptyConditionQuery(), quantifier: 'none' },
    });
    const changedCondition = asyncRulesOf(changed).conditions[0];
    expect(changedCondition?.kind === 'records' ? changedCondition.query.quantifier : '').toBe(
      'none',
    );

    const back = removeConditionAt(changed, 0);
    expect(back.conditions).toEqual([{ kind: 'role_in', roles: ['assignee'] }]);
  });

  it('проверка records появляется с пустой подписью и политикой по умолчанию', () => {
    const withCheck = addValidator(base, newRecordsValidator());
    const check = asyncRulesOf(withCheck).validators[0]!;
    expect(check.kind).toBe('records');
    if (check.kind === 'records') {
      expect(check.title).toBe('');
      expect(check.override).toEqual({ mode: 'default', extraUserIds: [] });
    }
    // Прежние гейты не тронуты.
    expect(withCheck.validators[0]).toEqual({ kind: 'no_open_subtasks' });

    const retitled = updateValidatorAt(withCheck, 0, { ...check, title: 'Смежники не приняли' });
    expect((retitled.validators[1] as { title: string }).title).toBe('Смежники не приняли');

    // Индекс — среди проверок выборки: снимаем её, прежний гейт остаётся.
    const cleaned = removeValidatorAt(retitled, 0);
    expect(cleaned.validators).toEqual([{ kind: 'no_open_subtasks' }]);
  });

  it('формула-проверка требует AST с самого начала', () => {
    const withFormula = addValidator(base, newFormulaValidator({ kind: 'literal', value: true }));
    const formula = asyncRulesOf(withFormula).validators[0]!;
    expect(formula.kind).toBe('formula');
  });

  it('выборка: субъект, квантор и лимит предикатов', () => {
    let query = emptyConditionQuery();
    query = withSubject(query, { kind: 'subtasks' });
    expect(query.subject).toEqual({ kind: 'subtasks' });

    query = setQuantifier(query, 'any');
    expect(query.quantifier).toBe('any');

    for (let i = 0; i < 12; i += 1) {
      query = addPredicate(query, { kind: 'result_issued' });
    }
    expect(query.where).toHaveLength(10);

    query = removePredicateAt(query, 0);
    expect(query.where).toHaveLength(9);
  });

  it('обход: запрет вычищает допуски, роль ставится и снимается', () => {
    const check = { ...newRecordsValidator(), title: 'Проверка' };
    const forbidden = withOverridePolicy(check, { mode: 'forbidden', extraUserIds: [] });
    expect(forbidden.override.mode).toBe('forbidden');

    const withRole = withOverridePolicy(forbidden, {
      mode: 'default',
      projectRole: 'manager',
    });
    expect(withRole.override.projectRole).toBe('manager');
    expect(withRole.override.mode).toBe('default');
  });
});
