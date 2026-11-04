import { describe, expect, it } from 'vitest';

import type {
  WorkflowDraftDocument,
  WorkflowDraftStage,
  WorkflowDraftTransition,
} from './workflow-document.schemas.js';
import { checkWorkflowDocument, hasBlockingProblems } from './workflow-document-check.js';
import type { WorkflowActorRole, WorkflowTransitionRules } from './workflow.schemas.js';

/** Каркас «Стандартного» маршрута — валидная база для проверок кастомных
 *  полей в окне и гейтах (#431). */
const mkStage = (
  id: string,
  name: string,
  systemState: WorkflowDraftStage['systemState'],
  extra: Partial<WorkflowDraftStage> = {},
): WorkflowDraftStage => ({
  id,
  code: null,
  name,
  color: 'neutral',
  systemState,
  outcome: systemState === 'closed' ? 'success' : null,
  isInitial: false,
  sortOrder: 0,
  ...extra,
});

const roles = (...list: WorkflowActorRole[]): WorkflowTransitionRules => ({
  conditions: [{ kind: 'role_in', roles: [...list] }],
  validators: [],
  postFunctions: [],
});

const mkTransition = (
  id: string,
  name: string,
  from: string | null,
  to: string,
  extra: Partial<WorkflowDraftTransition> = {},
): WorkflowDraftTransition => ({
  id,
  code: null,
  name,
  fromStageId: from,
  toStageId: to,
  display: 'button',
  intent: 'action',
  sortOrder: 0,
  rules: roles('assignee'),
  form: { enabled: false, sections: [] },
  ...extra,
});

function baseDocument(): WorkflowDraftDocument {
  const stages = [
    mkStage('s1', 'Ожидает', 'backlog', { isInitial: true }),
    mkStage('s2', 'В работе', 'active'),
    mkStage('s5', 'Завершена', 'closed', { outcome: 'success' }),
  ];
  const transitions = [
    mkTransition('t-start', 'Взять в работу', 's1', 's2', { display: 'primary' }),
    mkTransition('t-accept', 'Утвердить', 's2', 's5', { display: 'primary' }),
    mkTransition('t-reopen', 'Вернуть', 's5', 's2', { rules: roles('creator') }),
  ];
  return { stages, transitions };
}

describe('checkWorkflowDocument: кастомные поля в окне и гейтах (#431)', () => {
  const CF_ACTIVE = '50000000-0000-4000-8000-000000000001';
  const CF_HIDDEN = '50000000-0000-4000-8000-000000000002';
  const facts = { active: new Set([CF_ACTIVE, CF_HIDDEN]), hidden: new Set([CF_HIDDEN]) };

  it('без фактов проверки полей пропускаются', () => {
    const doc = baseDocument();
    doc.transitions[0]!.rules.validators = [
      { kind: 'fields_required', fields: [`cf.${crypto.randomUUID()}`] },
    ];
    expect(checkWorkflowDocument(doc)).toEqual([]);
  });

  it('неизвестное поле — ошибка custom_field_unknown', () => {
    const doc = baseDocument();
    doc.transitions[0]!.rules.validators = [
      { kind: 'fields_required', fields: [`cf.${crypto.randomUUID()}`] },
    ];
    expect(checkWorkflowDocument(doc, { customFields: facts })).toContainEqual(
      expect.objectContaining({ code: 'custom_field_unknown', transitionId: 't-start' }),
    );
  });

  it('скрытый атрибут в окне — предупреждение custom_field_hidden', () => {
    const doc = baseDocument();
    doc.transitions[0]!.form = {
      enabled: true,
      sections: [{ kind: 'fields', fields: [`cf.${CF_HIDDEN}`] }],
    };
    const problems = checkWorkflowDocument(doc, { customFields: facts });
    expect(problems).toContainEqual(
      expect.objectContaining({
        code: 'custom_field_hidden',
        severity: 'warning',
        transitionId: 't-start',
      }),
    );
    expect(hasBlockingProblems(problems)).toBe(false);
  });

  it('скрытый атрибут в условии — без проблем (значение ставит автоматика)', () => {
    const doc = baseDocument();
    doc.transitions[0]!.rules.validators = [
      { kind: 'fields_required', fields: [`cf.${CF_HIDDEN}`] },
    ];
    expect(checkWorkflowDocument(doc, { customFields: facts })).toEqual([]);
  });

  it('активное поле в окне и гейте — без проблем', () => {
    const doc = baseDocument();
    doc.transitions[0]!.form = {
      enabled: true,
      sections: [{ kind: 'fields', fields: [`cf.${CF_ACTIVE}`] }],
    };
    doc.transitions[0]!.rules.validators = [
      { kind: 'fields_required', fields: ['deadline', `cf.${CF_ACTIVE}`] },
    ];
    expect(checkWorkflowDocument(doc, { customFields: facts })).toEqual([]);
  });
});
