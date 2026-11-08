import { describe, expect, it } from 'vitest';

import { parseRules } from '../transition-rules.js';
import { parseForm } from '../transition-form.js';
import { gateFacts } from '../gate-facts.test-helper.js';
import { TX, USER, setup, transition } from './workflow-engine.test-helper.js';

/** Замки записи в движке (#496, Р4, В10). */
describe('WorkflowEngine — замки окна (#496)', () => {
  const lock = { key: 'deadline', editors: 'none' as const };

  it('нажатие ставит замки включённого окна в той же транзакции', async () => {
    const { engine, adapter, order } = setup([
      transition({
        form: parseForm({
          enabled: true,
          sections: [{ kind: 'fields', fields: [{ key: 'description' }] }],
          locks: [lock],
        }),
      }),
    ]);
    adapter.applyLocks.mockImplementation(async () => void order.push('applyLocks'));
    await engine.execute(TX, 't1', 'task', USER, { transitionId: 'tr' });
    expect(adapter.applyLocks).toHaveBeenCalledWith(TX, 't1', 'bob', [lock], {
      transitionId: 'tr',
      transitionName: 'Завершить',
    });
    // Замки — сразу после окна, до гейтов/смены стадии (та же транзакция).
    expect(order).toEqual(['lock', 'subject', 'applyLocks', 'applyStage', 'journal']);
  });

  it('выключенное окно замков не ставит (В13)', async () => {
    const { engine, adapter } = setup([
      transition({
        form: parseForm({
          enabled: false,
          sections: [{ kind: 'fields', fields: [{ key: 'description' }] }],
          locks: [lock],
        }),
      }),
    ]);
    adapter.applyLocks.mockImplementation(async () => void 0);
    await engine.execute(TX, 't1', 'task', USER, { transitionId: 'tr' });
    expect(adapter.applyLocks).not.toHaveBeenCalled();
  });

  it('writableKeys: настроенное поле и пустое поле условия — мимо замка', async () => {
    let filled = false;
    const { engine, adapter } = setup(
      [
        transition({
          form: parseForm({
            enabled: true,
            sections: [{ kind: 'fields', fields: [{ key: 'description' }] }],
          }),
          rules: parseRules({
            conditions: [{ kind: 'role_in', roles: ['assignee'] }],
            validators: [{ kind: 'fields_required', fields: ['deadline'] }],
          }),
        }),
      ],
      () =>
        gateFacts({
          assigneeId: 'bob',
          ...(filled ? { deadline: new Date('2026-12-01T00:00:00.000Z') } : {}),
        }),
    );
    // Окно «заполнило» поле условия — гейт видит свежие факты.
    adapter.applyForm.mockImplementationOnce(async () => {
      filled = true;
      return {
        fields: { deadline: { from: null, to: '2026-12-01T00:00:00.000Z' } },
        timeEntryId: null,
        result: null,
      };
    });
    await engine.execute(
      TX,
      't1',
      'task',
      USER,
      { transitionId: 'tr' },
      { form: { fields: { description: 'текст' } } },
    );
    expect(adapter.applyForm).toHaveBeenCalledWith(
      TX,
      't1',
      { id: 'bob', permissions: [] },
      { fields: { description: 'текст' } },
      { writableKeys: new Set(['description', 'deadline']) },
    );
  });
});
