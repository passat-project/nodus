import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { parseForm } from '../transition-form.js';
import { parseRules } from '../transition-rules.js';
import { DONE, TX, USER, setup, transition } from './workflow-engine.test-helper.js';

/**
 * Исполняемая кнопка при выборе по целевой стадии (DnD) — #866, AUD-008:
 * окно и замки относятся к той же кнопке, чьи гейты прошли. Заменная кнопка
 * без обязательного окна допустима; с обязательным — отказ 422.
 */

const gateFails = () =>
  parseRules({
    conditions: [{ kind: 'role_in', roles: ['assignee'] }],
    validators: [{ kind: 'result_present' }],
  });

const lockOf = (key: string) => ({ key, editors: 'none' as const });

describe('WorkflowEngine — исполняемая кнопка при DnD (#866, AUD-008)', () => {
  it('заменная кнопка с обязательным окном — 422, переход не выполнен', async () => {
    const { engine, adapter, records } = setup([
      transition({ id: 'first', sortOrder: 0, rules: gateFails() }),
      transition({
        id: 'second',
        sortOrder: 1,
        form: parseForm({
          enabled: true,
          sections: [{ kind: 'comment', label: 'Причина', required: true }],
        }),
      }),
    ]);

    await expect(engine.execute(TX, 't1', 'task', USER, { stageId: DONE })).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
      details: { transitionId: 'second', missing: ['comment'] },
    });
    expect(adapter.applyStage).not.toHaveBeenCalled();
    expect(adapter.applyLocks).not.toHaveBeenCalled();
    expect(records.insert).not.toHaveBeenCalled();
  });

  it('исполнена вторая кнопка: её замки, замки первой не применены', async () => {
    const firstLock = lockOf('priority');
    const secondLock = lockOf('deadline');
    const { engine, adapter } = setup([
      transition({
        id: 'first',
        name: 'Первая',
        sortOrder: 0,
        rules: gateFails(),
        form: parseForm({ enabled: true, sections: [], locks: [firstLock] }),
      }),
      transition({
        id: 'second',
        name: 'Вторая',
        sortOrder: 1,
        form: parseForm({ enabled: true, sections: [], locks: [secondLock] }),
      }),
    ]);

    const result = await engine.execute(TX, 't1', 'task', USER, { stageId: DONE });

    expect(result.stage.id).toBe(DONE);
    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: DONE }),
      'bob',
      expect.objectContaining({ transitionId: 'second' }),
    );
    expect(adapter.applyLocks).toHaveBeenCalledTimes(1);
    expect(adapter.applyLocks).toHaveBeenCalledWith(TX, 't1', 'bob', [secondLock], {
      transitionId: 'second',
      transitionName: 'Вторая',
    });
  });

  it('выбор по transitionId не переигрывается на другую кнопку', async () => {
    const { engine, adapter, records } = setup([
      transition({ id: 'chosen', sortOrder: 0, rules: gateFails() }),
      transition({ id: 'other', sortOrder: 1 }),
    ]);

    await expect(
      engine.execute(TX, 't1', 'task', USER, { transitionId: 'chosen' }),
    ).rejects.toMatchObject({ code: ErrorCode.WORKFLOW_TRANSITION_BLOCKED });
    expect(adapter.applyStage).not.toHaveBeenCalled();
    expect(records.insert).not.toHaveBeenCalled();
  });
});
