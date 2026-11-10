import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { parseForm } from '../transition-form.js';
import { parseRules } from '../transition-rules.js';
import { gateFacts } from '../gate-facts.test-helper.js';
import type { ActionDef } from '../workflow.repository.js';
import { ACTIVE, DONE, TX, USER, facts, setup } from './workflow-engine.test-helper.js';

const action = (partial: Partial<ActionDef> = {}): ActionDef => ({
  id: 'act',
  name: 'Запросить уточнение',
  stageId: ACTIVE,
  display: 'button',
  sortOrder: 0,
  rules: parseRules({ conditions: [{ kind: 'role_in', roles: ['assignee'] }] }),
  form: parseForm({}),
  steps: [],
  ...partial,
});

describe('WorkflowEngine — действие без смены статуса (#633)', () => {
  it('окно применяется, журнал пишется со from = to и actionId, стадия не меняется', async () => {
    const { engine, adapter, records, order } = setup([], () => facts, [
      action({
        form: parseForm({
          enabled: true,
          sections: [{ kind: 'comment', label: 'Что уточнить', required: false }],
        }),
      }),
    ]);

    const result = await engine.pressAction(TX, 't1', 'task', USER, 'act', {
      form: { comment: 'Уточните марку' },
    });

    expect(result.actionName).toBe('Запросить уточнение');
    expect(result.stageName).toBe('В работе');
    expect(result.recordId).toMatch(/[0-9a-f-]{36}/);
    expect(order).toEqual(['lock', 'subject', 'applyForm', 'subject', 'journal']);
    expect(adapter.applyStage).not.toHaveBeenCalled();
    expect(records.insert).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        entityKind: 'task',
        transitionId: null,
        actionId: 'act',
        fromStageId: ACTIVE,
        toStageId: ACTIVE,
        recordKind: 'action',
      }),
    );
  });

  it('действие с шагами отклоняется WORKFLOW_INVALID — «нажал и ничего» не бывает', async () => {
    const { engine, adapter, records } = setup([], undefined, [
      action({ steps: [{ kind: 'assign_number' }] }),
    ]);
    await expect(engine.pressAction(TX, 't1', 'task', USER, 'act')).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_INVALID,
    });
    expect(adapter.applyForm).not.toHaveBeenCalled();
    expect(records.insert).not.toHaveBeenCalled();
  });

  it('чужой статус и невидимая роль — WORKFLOW_TRANSITION_NOT_ALLOWED', async () => {
    const foreign = setup([], undefined, [action({ stageId: DONE })]);
    await expect(foreign.engine.pressAction(TX, 't1', 'task', USER, 'act')).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
    });

    const hidden = setup([], undefined, [
      action({
        rules: parseRules({ conditions: [{ kind: 'role_in', roles: ['creator'] }] }),
      }),
    ]);
    await expect(hidden.engine.pressAction(TX, 't1', 'task', USER, 'act')).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
    });
  });

  it('обязательные разделы окна проверяются до применения: пустое тело — 422', async () => {
    const { engine, adapter, records } = setup([], undefined, [
      action({
        form: parseForm({
          enabled: true,
          sections: [{ kind: 'comment', label: 'Что уточнить', required: true }],
        }),
      }),
    ]);
    await expect(
      engine.pressAction(TX, 't1', 'task', USER, 'act', { form: {} }),
    ).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
      details: { transitionId: 'act', missing: ['comment'] },
    });
    expect(adapter.applyForm).not.toHaveBeenCalled();
    expect(records.insert).not.toHaveBeenCalled();
  });

  it('лишние поля мимо окна — 422 (та же граница, что у перехода)', async () => {
    const { engine } = setup([], undefined, [action()]);
    await expect(
      engine.pressAction(TX, 't1', 'task', USER, 'act', {
        form: { comment: 'не из окна' },
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
      details: { unexpected: ['comment'] },
    });
  });

  it('гейт действия не пройден — 409 с причинами до записи журнала', async () => {
    const { engine, records } = setup([], undefined, [
      action({
        rules: parseRules({
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [{ kind: 'time_logged' }],
        }),
      }),
    ]);
    await expect(engine.pressAction(TX, 't1', 'task', USER, 'act')).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_TRANSITION_BLOCKED,
      details: { reasons: [{ kind: 'time_logged' }] },
    });
    expect(records.insert).not.toHaveBeenCalled();
  });

  it('гейт считается ПОСЛЕ окна: результат из окна закрывает result_present', async () => {
    const { engine, records, wasApplied } = setup(
      [],
      () => gateFacts({ assigneeId: 'bob', hasResult: wasApplied() }),
      [
        action({
          rules: parseRules({
            conditions: [{ kind: 'role_in', roles: ['assignee'] }],
            validators: [{ kind: 'result_present' }],
          }),
          form: parseForm({
            enabled: true,
            sections: [{ kind: 'result' }],
          }),
        }),
      ],
    );

    await engine.pressAction(TX, 't1', 'task', USER, 'act', {
      form: { result: { text: 'Готово', messageIds: [] } },
    });
    expect(records.insert).toHaveBeenCalled();
  });
});
