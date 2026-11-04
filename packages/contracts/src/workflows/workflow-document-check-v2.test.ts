import { describe, expect, it } from 'vitest';

import { Permission } from '../auth/permission.js';
import type {
  WorkflowDraftDocument,
  WorkflowDraftStage,
  WorkflowDraftTransition,
} from './workflow-document.schemas.js';
import { checkWorkflowDocument } from './workflow-document-check.js';
import type { WorkflowActorRole, WorkflowTransitionRules } from './workflow.schemas.js';

/** Новые правила движка #430: третий итог, имена статусов, дубли целей и
 *  акторный пропуск. Каркас совпадает с основным тестом проверки. */
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
  return {
    stages: [
      mkStage('s1', 'Ожидает', 'backlog', { isInitial: true }),
      mkStage('s2', 'В работе', 'active'),
      mkStage('s3', 'Приостановлена', 'paused'),
      mkStage('s4', 'На утверждении', 'done'),
      mkStage('s5', 'Завершена', 'closed', { outcome: 'success' }),
      mkStage('s6', 'Отменена', 'closed', { outcome: 'cancelled' }),
    ],
    transitions: [
      mkTransition('t-start', 'Взять в работу', 's1', 's2', { display: 'primary' }),
      mkTransition('t-complete', 'Завершить', 's2', 's4', {
        display: 'primary',
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [{ kind: 'no_open_subtasks' }],
          postFunctions: [{ kind: 'route_if', when: 'creator_is_assignee', toStageId: 's5' }],
        },
      }),
      mkTransition('t-pause', 'Приостановить', 's2', 's3'),
      mkTransition('t-continue', 'Продолжить', 's3', 's2', { display: 'primary' }),
      mkTransition('t-accept', 'Утвердить', 's4', 's5', {
        display: 'primary',
        rules: roles('creator'),
      }),
      mkTransition('t-return', 'Вернуть на доработку', 's4', 's2', { rules: roles('creator') }),
      mkTransition('t-resume-done', 'Возобновить', 's5', 's2', {
        rules: roles('creator', 'assignee'),
      }),
      mkTransition('t-cancel', 'Отменить', null, 's6', {
        display: 'menu',
        rules: roles('creator'),
      }),
      mkTransition('t-reopen', 'Восстановить', 's6', 's1', { rules: roles('creator') }),
    ],
  };
}

const codes = (problems: ReturnType<typeof checkWorkflowDocument>) => problems.map((p) => p.code);

describe('checkWorkflowDocument: правила v2 (#430)', () => {
  it('rejected — законный третий итог закрытого статуса', () => {
    const doc = baseDocument();
    doc.stages.find((s) => s.id === 's5')!.outcome = 'rejected';
    expect(codes(checkWorkflowDocument(doc))).not.toContain('outcome_mismatch');
  });

  it('action_without_visibility — кнопка-действие только с правом, у задачи', () => {
    const doc = baseDocument();
    doc.transitions.push(
      mkTransition('t-manage', 'Управленческое', 's2', 's5', {
        rules: {
          conditions: [{ kind: 'permission', permission: Permission.WORKFLOW_MANAGE }],
          validators: [],
          postFunctions: [],
        },
      }),
    );
    expect(
      checkWorkflowDocument(doc).filter(
        (p) => p.code === 'action_without_visibility' && p.transitionId === 't-manage',
      ),
    ).toHaveLength(1);
    // У письма «Моих действий» нет — не шумим.
    expect(
      checkWorkflowDocument(doc, { category: 'letter' }).some(
        (p) => p.code === 'action_without_visibility' && p.transitionId === 't-manage',
      ),
    ).toBe(false);
  });

  it('action_without_visibility — служебная кнопка не предупреждается', () => {
    const doc = baseDocument();
    doc.transitions.push(
      mkTransition('t-service', 'Служебная', 's2', 's3', {
        intent: 'service',
        rules: {
          conditions: [{ kind: 'permission', permission: Permission.WORKFLOW_MANAGE }],
          validators: [],
          postFunctions: [],
        },
      }),
    );
    expect(checkWorkflowDocument(doc).some((p) => p.code === 'action_without_visibility')).toBe(
      false,
    );
  });

  it('stage_name_shared / stage_name_similar — мягкий каталог имён', () => {
    const shared = checkWorkflowDocument(baseDocument(), {
      stageNameFacts: [{ systemState: 'active', name: 'В работе' }],
    });
    expect(shared).toContainEqual(
      expect.objectContaining({ code: 'stage_name_shared', stageId: 's2' }),
    );
    const similar = checkWorkflowDocument(baseDocument(), {
      stageNameFacts: [{ systemState: 'active', name: '  в  работе ' }],
    });
    expect(similar).toContainEqual(
      expect.objectContaining({ code: 'stage_name_similar', stageId: 's2' }),
    );
  });

  it('stage_name_* — только для новых/переименованных стадий (scope)', () => {
    const facts = { stageNameFacts: [{ systemState: 'active' as const, name: 'В работе' }] };
    // Неизменённый статус вне scope: копия каталога не шумит.
    const untouched = checkWorkflowDocument(baseDocument(), {
      ...facts,
      stageNameStageIds: new Set(['s3']),
    });
    expect(untouched.some((p) => p.code === 'stage_name_shared')).toBe(false);
    // Переименованный статус в scope: предупреждение остаётся.
    const renamed = checkWorkflowDocument(baseDocument(), {
      ...facts,
      stageNameStageIds: new Set(['s2']),
    });
    expect(renamed).toContainEqual(
      expect.objectContaining({ code: 'stage_name_shared', stageId: 's2' }),
    );
  });

  it('duplicate_transition_target — две кнопки из одного статуса в один', () => {
    const doc = baseDocument();
    doc.transitions.push(mkTransition('t-pause-2', 'Ещё пауза', 's2', 's3'));
    expect(checkWorkflowDocument(doc)).toContainEqual(
      expect.objectContaining({ code: 'duplicate_transition_target', transitionId: 't-pause-2' }),
    );
  });

  it('approver_rule_unresolvable — служебная основная кнопка не утверждает', () => {
    const doc = baseDocument();
    doc.transitions.find((t) => t.id === 't-complete')!.rules.postFunctions = [
      { kind: 'route_if', when: 'approver_is_actor', toStageId: 's5' },
    ];
    doc.transitions.find((t) => t.id === 't-accept')!.intent = 'service';
    expect(checkWorkflowDocument(doc)).toContainEqual(
      expect.objectContaining({ code: 'approver_rule_unresolvable', transitionId: 't-complete' }),
    );
  });

  it('approver_rule_unresolvable — обязательное окно основной кнопки', () => {
    const doc = baseDocument();
    doc.transitions.find((t) => t.id === 't-complete')!.rules.postFunctions = [
      { kind: 'route_if', when: 'approver_is_actor', toStageId: 's5' },
    ];
    doc.transitions.find((t) => t.id === 't-accept')!.form = {
      enabled: true,
      sections: [{ kind: 'comment', label: 'Протокол', required: true }],
    };
    expect(checkWorkflowDocument(doc)).toContainEqual(
      expect.objectContaining({ code: 'approver_rule_unresolvable', transitionId: 't-complete' }),
    );
  });

  it('approver_rule_unresolvable — цель не этап утверждения', () => {
    const doc = baseDocument();
    const complete = doc.transitions.find((t) => t.id === 't-complete')!;
    complete.toStageId = 's3';
    complete.rules.postFunctions = [
      { kind: 'route_if', when: 'approver_is_actor', toStageId: 's5' },
    ];
    expect(checkWorkflowDocument(doc)).toContainEqual(
      expect.objectContaining({ code: 'approver_rule_unresolvable', transitionId: 't-complete' }),
    );
  });

  it('approver_rule_unresolvable — основная кнопка только с правом', () => {
    const doc = baseDocument();
    doc.transitions.find((t) => t.id === 't-complete')!.rules.postFunctions = [
      { kind: 'route_if', when: 'approver_is_actor', toStageId: 's5' },
    ];
    doc.transitions.find((t) => t.id === 't-accept')!.rules = {
      conditions: [{ kind: 'permission', permission: Permission.WORKFLOW_MANAGE }],
      validators: [],
      postFunctions: [],
    };
    expect(checkWorkflowDocument(doc)).toContainEqual(
      expect.objectContaining({ code: 'approver_rule_unresolvable', transitionId: 't-complete' }),
    );
  });
});
