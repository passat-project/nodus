import { describe, expect, it } from 'vitest';

import { checkWorkflowDocument } from './workflow-document-check.js';
import type {
  WorkflowDraftDocument,
  WorkflowDraftTransition,
} from './workflow-document.schemas.js';
import type { DeciderSource } from './decider.js';

const POSITION = '22222222-2222-4222-8222-222222222222';
const FIELD = '33333333-3333-4333-8333-333333333333';
const EMPTY_FORM = { enabled: false, sections: [] };

function taskDoc(
  decider: DeciderSource,
  patch: Partial<WorkflowDraftTransition> = {},
): WorkflowDraftDocument {
  return {
    stages: [
      {
        id: 's:new',
        code: 'new',
        name: 'Новая',
        color: 'neutral',
        systemState: 'backlog',
        outcome: null,
        isInitial: true,
        sortOrder: 0,
      },
      {
        id: 's:work',
        code: 'work',
        name: 'В работе',
        color: 'info',
        systemState: 'active',
        outcome: null,
        isInitial: false,
        sortOrder: 1,
      },
      {
        id: 's:done',
        code: 'done',
        name: 'Завершена',
        color: 'success',
        systemState: 'closed',
        outcome: 'success',
        isInitial: false,
        sortOrder: 2,
      },
    ],
    transitions: [
      {
        id: 't:decide',
        code: 'decide',
        name: 'Разрешить',
        fromStageId: 's:new',
        toStageId: 's:work',
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        rules: {
          conditions: [{ kind: 'decider_in', source: decider }],
          validators: [],
          postFunctions: [],
        },
        form: EMPTY_FORM,
        ...patch,
      },
      {
        id: 't:finish',
        code: 'finish',
        name: 'Завершить',
        fromStageId: 's:work',
        toStageId: 's:done',
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [],
          postFunctions: [],
        },
        form: EMPTY_FORM,
      },
    ],
  };
}

const codes = (doc: WorkflowDraftDocument, opts = {}) =>
  checkWorkflowDocument(doc, { category: 'task', ...opts }).map((p) => p.code);

describe('checkDeciderRules (#433)', () => {
  it('валидный источник должности не даёт ошибок', () => {
    const result = codes(
      taskDoc({ kind: 'position', positionId: POSITION, positionKind: 'management' }),
    );
    expect(result).not.toContain('decider_position_missing');
    expect(result).not.toContain('decider_position_empty');
  });

  it('должность отсутствует или архивна — ошибка', () => {
    const doc = taskDoc({ kind: 'position', positionId: POSITION, positionKind: 'management' });
    expect(
      codes(doc, { positions: new Map([[POSITION, { isActive: false, holders: 2 }]]) }),
    ).toContain('decider_position_missing');
    expect(codes(doc, { positions: new Map() })).toContain('decider_position_missing');
  });

  it('на должности никого нет — предупреждение, не ошибка', () => {
    const doc = taskDoc({ kind: 'position', positionId: POSITION, positionKind: 'management' });
    const problems = checkWorkflowDocument(doc, {
      category: 'task',
      positions: new Map([[POSITION, { isActive: true, holders: 0 }]]),
    });
    const empty = problems.find((p) => p.code === 'decider_position_empty');
    expect(empty?.severity).toBe('warning');
  });

  it('поле не «Сотрудник(и)» — ошибка', () => {
    const doc = taskDoc({ kind: 'field', field: `cf.${FIELD}` });
    const result = codes(doc, { definitions: [{ id: FIELD, type: 'text' }] });
    expect(result).toContain('decider_field_not_user');
  });

  it('поле «Сотрудники» проходит', () => {
    const doc = taskDoc({ kind: 'field', field: `cf.${FIELD}` });
    const result = codes(doc, { definitions: [{ id: FIELD, type: 'users' }] });
    expect(result).not.toContain('decider_field_not_user');
  });

  it('удалённый атрибут — общая ошибка custom_field_unknown', () => {
    const doc = taskDoc({ kind: 'field', field: `cf.${FIELD}` });
    const result = codes(doc, {
      customFields: { active: new Set(), hidden: new Set() },
      definitions: [{ id: FIELD, type: 'users' }],
    });
    expect(result).toContain('custom_field_unknown');
  });

  it('кнопка только для решающих не требует прав участника', () => {
    const doc = taskDoc(
      { kind: 'employees', userIds: [FIELD] },
      {
        rules: {
          conditions: [{ kind: 'decider_in', source: { kind: 'employees', userIds: [FIELD] } }],
          validators: [{ kind: 'fields_required', fields: ['description'] }],
          postFunctions: [],
        },
      },
    );
    expect(codes(doc)).toContain('decider_window_needs_rights');
  });

  it('смешанные условия (роль + решающий) с гейтом полей допустимы', () => {
    const doc = taskDoc(
      { kind: 'employees', userIds: [FIELD] },
      {
        rules: {
          conditions: [
            { kind: 'role_in', roles: ['creator'] },
            { kind: 'decider_in', source: { kind: 'employees', userIds: [FIELD] } },
          ],
          validators: [{ kind: 'fields_required', fields: ['description'] }],
          postFunctions: [],
        },
      },
    );
    expect(codes(doc)).not.toContain('decider_window_needs_rights');
  });

  it('письмо с decider_in — ошибка категории', () => {
    const doc = taskDoc({ kind: 'employees', userIds: [FIELD] });
    const problems = checkWorkflowDocument(doc, { category: 'letter' });
    expect(problems.map((p) => p.code)).toContain('decider_not_in_category');
  });
});
