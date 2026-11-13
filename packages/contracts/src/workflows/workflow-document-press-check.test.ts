import { describe, expect, it } from 'vitest';

import { checkPressRules } from './workflow-document-press-check.js';
import type { WorkflowDraftTransition } from './workflow-document.schemas.js';

const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const FIELD = 'a0000000-0000-4000-8000-000000000001';

const base = (press: WorkflowDraftTransition['press']): WorkflowDraftTransition => ({
  id: 't1',
  code: null,
  name: 'Ознакомлен',
  fromStageId: S1,
  toStageId: S2,
  display: 'primary',
  intent: 'action',
  sortOrder: 0,
  rules: { conditions: [], validators: [], postFunctions: [] },
  form: { enabled: false, sections: [] },
  press,
});

const press = (source: unknown, extra: Record<string, unknown> = {}) =>
  ({
    sources: [source],
    quorum: { kind: 'all' },
    order: 'parallel',
    excludeAuthor: true,
    ...extra,
  }) as never;

describe('checkPressRules (#434)', () => {
  it('задача с соисполнителями — без ошибок', () => {
    expect(checkPressRules([base(press({ kind: 'coexecutors' }))], { category: 'task' })).toEqual(
      [],
    );
  });

  it('письмо и пустые источники запрещены', () => {
    expect(
      checkPressRules([base(press({ kind: 'coexecutors' }))], { category: 'letter' }).map(
        (problem) => problem.code,
      ),
    ).toContain('press_not_in_category');
    expect(
      checkPressRules([base(press({ kind: 'coexecutors' }, { sources: [] }))], {
        category: 'task',
      }).map((problem) => problem.code),
    ).toContain('press_source_empty');
  });

  it('роль письма и поле-текст в источниках задачи — ошибки', () => {
    const codes = checkPressRules(
      [
        base(
          press(
            { kind: 'role', roles: ['addressee'] },
            {
              sources: [
                { kind: 'role', roles: ['addressee'] },
                { kind: 'field', field: `cf.${FIELD}` },
              ],
            },
          ),
        ),
      ],
      {
        category: 'task',
        definitions: [{ id: FIELD, type: 'text' }],
      },
    ).map((problem) => problem.code);
    expect(codes).toContain('press_role_not_in_category');
    expect(codes).toContain('press_field_not_user');
  });

  it('должность без держателей — ошибка', () => {
    const transition = base(
      press({ kind: 'position', positionId: 'p1', positionKind: 'management' }),
    );
    expect(
      checkPressRules([transition], {
        category: 'task',
        positions: new Map([['p1', { kind: 'management', isActive: true, holders: 0 }]]),
      }).map((problem) => problem.code),
    ).toContain('press_position_empty');
  });

  it('одна коллективная кнопка на статус и обычная кнопка-действие', () => {
    const second = { ...base(press({ kind: 'coexecutors' })), id: 't2' };
    const codes = checkPressRules([base(press({ kind: 'coexecutors' })), second], {
      category: 'task',
    }).map((problem) => problem.code);
    expect(codes.filter((code) => code === 'press_multiple_per_stage')).toHaveLength(2);

    const menu = { ...base(press({ kind: 'coexecutors' })), display: 'menu' as const };
    expect(checkPressRules([menu], { category: 'task' }).map((problem) => problem.code)).toContain(
      'press_button_invalid',
    );
  });
});
