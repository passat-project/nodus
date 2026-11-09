import { describe, expect, it } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';

import { parseRules } from '../transition-rules.js';
import { parseForm } from '../transition-form.js';
import { ACTIVE, DONE, TX, USER, facts, setup, transition } from './workflow-engine.test-helper.js';

describe('WorkflowEngine — окно перехода (#380)', () => {
  it('порядок: условия по s0 → applyForm → гейты по s1 → applyStage → журнал', async () => {
    const { engine, adapter, records, order, wasApplied } = setup(
      [
        transition({
          rules: parseRules({
            conditions: [{ kind: 'role_in', roles: ['assignee'] }],
            validators: [{ kind: 'fields_required', fields: ['description'] }],
          }),
          form: parseForm({
            enabled: true,
            sections: [{ kind: 'fields', fields: ['description'] }],
          }),
        }),
      ],
      () => ({ ...facts, description: wasApplied() ? 'заполнено' : '' }),
    );
    const result = await engine.execute(
      TX,
      't1',
      'task',
      USER,
      { transitionId: 'tr' },
      {
        form: { fields: { description: 'заполнено' } },
      },
    );
    expect(result.stage.id).toBe(DONE);
    expect(order).toEqual(['lock', 'subject', 'applyForm', 'subject', 'applyStage', 'journal']);
    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: DONE }),
      'bob',
      expect.objectContaining({ recordId: result.recordId, transitionName: 'Завершить' }),
    );
    expect(records.insert).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        entityKind: 'task',
        transitionId: 'tr',
        fromStageId: ACTIVE,
        toStageId: DONE,
        fields: { description: { from: '', to: 'заполнено' } },
        recordKind: 'transition',
      }),
    );
  });

  it('форма без обязательной причины — 422 до applyForm', async () => {
    const { engine, adapter, records } = setup([
      transition({
        form: parseForm({
          enabled: true,
          sections: [{ kind: 'comment', label: 'Причина', required: true }],
        }),
      }),
    ]);
    await expect(
      engine.execute(TX, 't1', 'task', USER, { transitionId: 'tr' }, { form: {} }),
    ).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
      details: { transitionId: 'tr', missing: ['comment'] },
    });
    expect(adapter.applyForm).not.toHaveBeenCalled();
    expect(records.insert).not.toHaveBeenCalled();
  });

  it('гейт после окна не пройден — 409, applyStage и журнал не вызваны', async () => {
    const { engine, adapter, records } = setup([
      transition({
        rules: parseRules({
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [{ kind: 'fields_required', fields: ['description'] }],
        }),
        form: parseForm({
          enabled: true,
          sections: [{ kind: 'fields', fields: ['description'] }],
        }),
      }),
    ]);
    await expect(
      engine.execute(
        TX,
        't1',
        'task',
        USER,
        { transitionId: 'tr' },
        {
          form: { fields: { description: 'заполнено' } },
        },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.WORKFLOW_TRANSITION_BLOCKED });
    expect(adapter.applyForm).toHaveBeenCalled();
    expect(adapter.applyStage).not.toHaveBeenCalled();
    expect(records.insert).not.toHaveBeenCalled();
  });

  it('DnD: кандидат без обязательного окна предпочтён', async () => {
    const { engine, adapter } = setup([
      transition({
        id: 'with-window',
        sortOrder: 0,
        form: parseForm({
          enabled: true,
          sections: [{ kind: 'comment', label: 'Причина', required: true }],
        }),
      }),
      transition({ id: 'plain', sortOrder: 1 }),
    ]);
    const result = await engine.execute(TX, 't1', 'task', USER, { stageId: DONE });
    expect(result.stage.id).toBe(DONE);
    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.anything(),
      'bob',
      expect.objectContaining({ transitionId: 'plain' }),
    );
  });

  it('DnD: все кандидаты требуют окно — 422 с transitionId и missing', async () => {
    const { engine, adapter, records } = setup([
      transition({
        form: parseForm({
          enabled: true,
          sections: [{ kind: 'comment', label: 'Причина', required: true }],
        }),
      }),
    ]);
    await expect(engine.execute(TX, 't1', 'task', USER, { stageId: DONE })).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
      details: { transitionId: 'tr', missing: ['comment'] },
    });
    expect(adapter.applyStage).not.toHaveBeenCalled();
    expect(records.insert).not.toHaveBeenCalled();
  });

  it('available отдаёт окно и валидаторы кнопки', async () => {
    const { engine } = setup([
      transition({
        rules: parseRules({
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [{ kind: 'result_files', min: 2 }],
        }),
        form: parseForm({
          enabled: true,
          sections: [{ kind: 'result_files', label: 'Акт' }],
        }),
      }),
    ]);
    const buttons = await engine.available(TX, 't1', 'task', {
      id: 'bob',
      permissions: [Permission.TASK_MANAGE_ANY],
    });
    expect(buttons[0]).toMatchObject({
      form: { enabled: true },
      validators: [{ kind: 'result_files', min: 2 }],
      blockedBy: [{ kind: 'result_files', count: 0, min: 2 }],
    });
  });
});
