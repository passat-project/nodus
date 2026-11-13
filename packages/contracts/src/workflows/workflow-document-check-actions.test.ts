import { describe, expect, it } from 'vitest';

import {
  workflowDraftDocumentSchema,
  type WorkflowDraftAction,
  type WorkflowDraftDocument,
  type WorkflowDraftStage,
  type WorkflowDraftTransition,
} from './workflow-document.schemas.js';
import { checkWorkflowDocument } from './workflow-document-check.js';
import type { WorkflowActorRole, WorkflowTransitionRules } from './workflow.schemas.js';

/** #633: действия — кнопки без смены статуса. Каркас совпадает с основным
 *  тестом проверки (#430), добавляем только `actions`. */
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

const mkAction = (id: string, name: string, extra: Partial<WorkflowDraftAction> = {}) => ({
  id,
  code: null,
  name,
  stageId: 's2',
  display: 'button' as const,
  sortOrder: 0,
  rules: roles('assignee'),
  form: { enabled: true, sections: [] },
  steps: [],
  ...extra,
});

function baseDocument(actions: WorkflowDraftDocument['actions'] = []): WorkflowDraftDocument {
  return {
    stages: [
      mkStage('s1', 'Ожидает', 'backlog', { isInitial: true }),
      mkStage('s2', 'В работе', 'active'),
      mkStage('s5', 'Завершена', 'closed', { outcome: 'success' }),
    ],
    transitions: [
      mkTransition('t-start', 'Взять в работу', 's1', 's2', { display: 'primary' }),
      mkTransition('t-complete', 'Завершить', 's2', 's5', { display: 'primary' }),
    ],
    actions,
  };
}

const codes = (doc: WorkflowDraftDocument) => checkWorkflowDocument(doc).map((p) => p.code);

describe('действия маршрута (#633)', () => {
  it('действие без окна и без шагов — ошибка публикации', () => {
    const doc = baseDocument([
      mkAction('a-empty', 'Добавить замечание', {
        form: { enabled: false, sections: [] },
        steps: [],
      }),
    ]);
    const problem = checkWorkflowDocument(doc).find(
      (p) => p.code === 'action_without_form_and_steps',
    );
    expect(problem?.severity).toBe('error');
    expect(problem?.actionId).toBe('a-empty');
  });

  it('действие с окном проходит', () => {
    const doc = baseDocument([mkAction('a-form', 'Добавить замечание')]);
    expect(codes(doc)).not.toContain('action_without_form_and_steps');
  });

  it('действие только с шагами проходит', () => {
    const doc = baseDocument([
      mkAction('a-steps', 'Взять номер', {
        form: { enabled: false, sections: [] },
        steps: [{ kind: 'assign_number' }],
      }),
    ]);
    expect(codes(doc)).not.toContain('action_without_form_and_steps');
  });

  it('дубль названия действия в одном статусе — ошибка', () => {
    const doc = baseDocument([
      mkAction('a1', 'Добавить замечание'),
      mkAction('a2', 'добавить замечание'),
    ]);
    expect(codes(doc)).toContain('action_duplicate_name');
  });

  it('одно и то же имя у разных статусов — не дубль', () => {
    const doc = baseDocument([
      mkAction('a1', 'Добавить замечание'),
      mkAction('a2', 'Добавить замечание', { stageId: null }),
    ]);
    expect(codes(doc)).not.toContain('action_duplicate_name');
  });

  it('действие без условий «кто видит» — ошибка no_roles', () => {
    const doc = baseDocument([
      mkAction('a1', 'Замечание', { rules: { conditions: [], validators: [], postFunctions: [] } }),
    ]);
    expect(codes(doc)).toContain('no_roles');
  });

  it('действие только с правом — предупреждение, не ошибка', () => {
    const doc = baseDocument([
      mkAction('a1', 'Замечание', {
        rules: {
          conditions: [{ kind: 'permission', permission: 'workflow.manage' }],
          validators: [],
          postFunctions: [],
        },
      }),
    ]);
    const problem = checkWorkflowDocument(doc, { category: 'task' }).find(
      (p) => p.code === 'action_without_visibility',
    );
    expect(problem?.severity).toBe('warning');
    expect(problem?.actionId).toBe('a1');
  });

  it('действия не ломают запрет self_loop: петля-переход по-прежнему ошибка', () => {
    const doc = baseDocument([mkAction('a1', 'Замечание')]);
    doc.transitions.push(mkTransition('t-loop', 'Петля', 's2', 's2'));
    expect(codes(doc)).toContain('self_loop');
  });

  it('действие на статус вне документа — ошибка action_stage_unknown', () => {
    const doc = baseDocument([mkAction('a1', 'Замечание', { stageId: 'missing' })]);
    const problem = checkWorkflowDocument(doc).find((p) => p.code === 'action_stage_unknown');
    expect(problem?.severity).toBe('error');
    expect(problem?.actionId).toBe('a1');
  });

  it('две главные кнопки-действия в одной группе — multiple_primary', () => {
    const doc = baseDocument([
      mkAction('a1', 'Замечание', { display: 'primary' }),
      mkAction('a2', 'Уточнение', { display: 'primary' }),
    ]);
    const problems = checkWorkflowDocument(doc).filter((p) => p.code === 'multiple_primary');
    expect(problems.some((p) => p.actionId === 'a2')).toBe(true);
  });

  it('главное действие в статусе и в «любом» — не конфликт групп', () => {
    const doc = baseDocument([
      mkAction('a1', 'Замечание', { display: 'primary' }),
      mkAction('a2', 'Уточнение', { display: 'primary', stageId: null }),
    ]);
    const problems = checkWorkflowDocument(doc).filter(
      (p) => p.code === 'multiple_primary' && p.actionId !== undefined,
    );
    expect(problems).toEqual([]);
  });

  it('схема черновика: действия валидны, старый документ без них тоже', () => {
    // id в схеме — uuid | new:*: для проверки схемы берём валидные uuid.
    const u = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const stage = (n: number, name: string, state: string, initial = false) => ({
      id: u(n),
      code: null,
      name,
      color: 'neutral',
      systemState: state,
      outcome: null,
      isInitial: initial,
      sortOrder: n,
    });
    const rules = roles('assignee');
    const doc = {
      stages: [stage(1, 'Ожидает', 'backlog', true), stage(2, 'В работе', 'active')],
      transitions: [
        {
          id: u(3),
          code: null,
          name: 'Взять в работу',
          fromStageId: u(1),
          toStageId: u(2),
          display: 'primary',
          intent: 'action',
          sortOrder: 0,
          rules,
          form: { enabled: false, sections: [] },
        },
      ],
      actions: [
        {
          id: u(4),
          code: null,
          name: 'Добавить замечание',
          stageId: u(2),
          display: 'button',
          sortOrder: 0,
          rules,
          form: { enabled: true, sections: [] },
          steps: [],
        },
      ],
    };
    expect(() => workflowDraftDocumentSchema.parse(doc)).not.toThrow();
    const legacy = { ...doc, actions: undefined };
    expect(() => workflowDraftDocumentSchema.parse(legacy)).not.toThrow();
  });
});
