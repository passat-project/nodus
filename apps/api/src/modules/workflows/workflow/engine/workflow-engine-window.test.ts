import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';

import type {
  WorkflowActorSubject,
  WorkflowEntityStage,
  WorkflowFormApplied,
} from '../../../../core/ports/workflow-entity.port.js';
import { WorkflowEngine } from './workflow-engine.js';
import type { TransitionDef } from '../transition-rules.js';
import { parseRules } from '../transition-rules.js';
import { parseForm } from '../transition-form.js';
import { gateFacts } from '../gate-facts.test-helper.js';

const TX = { tx: true } as never;
const ACTIVE = '00000000-0000-4000-8000-000000000001';
const REVIEW = '00000000-0000-4000-8000-000000000002';
const DONE = '00000000-0000-4000-8000-000000000003';
const USER = { id: 'bob', permissions: [] as string[] };

const stage = (id: string, name: string, systemState: string) => ({
  id,
  code: null,
  name,
  systemState,
  archivedAt: null,
  workflowId: 'wf',
  color: 'neutral',
  sortOrder: 0,
  isInitial: false,
  outcome: systemState === 'closed' ? 'success' : null,
});

const facts = gateFacts({ assigneeId: 'bob' });

function transition(partial: Partial<TransitionDef>): TransitionDef {
  return {
    id: 'tr',
    name: 'Завершить',
    fromStageId: ACTIVE,
    toStageId: DONE,
    display: 'primary',
    intent: 'action',
    sortOrder: 0,
    rules: parseRules({ conditions: [{ kind: 'role_in', roles: ['assignee'] }] }),
    form: parseForm({}),
    ...partial,
  };
}

function setup(transitions: TransitionDef[], subjectFacts: () => typeof facts = () => facts) {
  const order: string[] = [];
  let applied = false;
  const workflow = {
    id: 'wf',
    stages: [
      stage(ACTIVE, 'В работе', 'active'),
      stage(REVIEW, 'На утверждении', 'done'),
      stage(DONE, 'Завершена', 'closed'),
    ],
    transitions,
  };
  const adapter = {
    lock: vi.fn(async () => void order.push('lock')),
    subject: vi.fn(async (): Promise<WorkflowActorSubject> => {
      order.push('subject');
      return {
        workflowId: 'wf',
        typeId: 'type',
        stageId: ACTIVE,
        roles: new Set(['assignee']),
        bypassConditions: false,
        canOverrideGates: false,
        actsWithoutConditions: true,
        facts: subjectFacts(),
      };
    }),
    applyForm: vi.fn(async (): Promise<WorkflowFormApplied> => {
      order.push('applyForm');
      applied = true;
      return {
        fields: { description: { from: '', to: 'заполнено' } },
        timeEntryId: null,
        result: null,
      };
    }),
    applyStage: vi.fn(async (_tx, _id, target: WorkflowEntityStage) => {
      order.push('applyStage');
      expect(target.id).toBe(DONE);
    }),
  };
  const workflows = { load: vi.fn(async () => workflow) };
  const records = { insert: vi.fn(async () => void order.push('journal')) };
  const engine = new WorkflowEngine(
    workflows as never,
    { get: () => adapter } as never,
    records as never,
    { nextForType: vi.fn() } as never,
    { plan: vi.fn(async () => ({ ok: true, issue: async () => ({}) })) } as never,
  );
  return { engine, adapter, records, order, wasApplied: () => applied };
}

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
