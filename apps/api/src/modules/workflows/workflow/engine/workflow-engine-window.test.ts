import { describe, expect, it, vi } from 'vitest';

import type {
  WorkflowActor,
  WorkflowActorSubject,
} from '../../../../core/ports/workflow-entity.port.js';
import { WorkflowEngine } from './workflow-engine.js';

/** Оконные сценарии движка (#430): роли/факты до и после окна, legacy-правило
 *  creator_is_assignee, режим времени if_empty и выбор колонки по systemState.
 *  Вынесено из общего workflow-engine.test.ts (I5): общий файл перерос 300 строк. */

const TX = { tx: true };
const STAGE_ACTIVE = '00000000-0000-4000-8000-000000000001';
const STAGE_REVIEW = '00000000-0000-4000-8000-000000000002';
const STAGE_DONE = '00000000-0000-4000-8000-000000000003';
const TRANSITION = '00000000-0000-4000-8000-000000000011';
const SUBMIT = '00000000-0000-4000-8000-000000000012';
const ACCEPT = '00000000-0000-4000-8000-000000000013';
const USER: WorkflowActor = { id: 'bob', permissions: [] };

const facts = {
  stageId: STAGE_ACTIVE,
  acceptRequired: false,
  creatorIsAssignee: false,
  openSubtasks: 0,
  reviewSubtasks: 0,
  checklistDone: 0,
  checklistTotal: 0,
  spentMinutes: 0,
  description: '',
  deadline: null,
  assigneeId: 'bob',
  plannedMinutes: null,
  hasResult: false,
  resultFileCount: 0,
  customFields: {},
  activeCustomFieldIds: new Set<string>(),
};

const stage = (
  id: string,
  name: string,
  systemState: 'active' | 'done' | 'closed',
  extra: Record<string, unknown> = {},
) => ({
  id,
  code: null,
  name,
  systemState,
  archivedAt: null,
  workflowId: 'wf-approval',
  color: 'neutral',
  sortOrder: 0,
  isInitial: id === STAGE_ACTIVE,
  outcome: systemState === 'closed' ? 'success' : null,
  ...extra,
});

const approvalWorkflow = {
  id: 'wf-approval',
  stages: [
    stage(STAGE_ACTIVE, 'В работе', 'active'),
    stage(STAGE_REVIEW, 'На утверждении', 'done'),
    stage(STAGE_DONE, 'Завершена', 'closed'),
  ],
  transitions: [
    {
      id: SUBMIT,
      name: 'Сдать работу',
      fromStageId: STAGE_ACTIVE,
      toStageId: STAGE_REVIEW,
      display: 'primary' as const,
      intent: 'action' as const,
      sortOrder: 0,
      rules: {
        conditions: [{ kind: 'role_in' as const, roles: ['assignee', 'creator', 'coexecutor'] }],
        validators: [],
        postFunctions: [
          { kind: 'route_if' as const, when: 'approver_is_actor' as const, toStageId: STAGE_DONE },
        ],
      },
    },
    {
      id: ACCEPT,
      name: 'Утвердить',
      fromStageId: STAGE_REVIEW,
      toStageId: STAGE_DONE,
      display: 'primary' as const,
      intent: 'action' as const,
      sortOrder: 0,
      rules: {
        conditions: [{ kind: 'role_in' as const, roles: ['creator' as const] }],
        validators: [],
        postFunctions: [],
      },
    },
  ],
};

/** Простой маршрут для проверок времени и выбора колонки. */
const simpleWorkflow = {
  id: 'wf',
  stages: [stage(STAGE_ACTIVE, 'В работе', 'active'), stage(STAGE_DONE, 'Завершена', 'closed')],
  transitions: [
    {
      id: TRANSITION,
      name: 'Завершить',
      fromStageId: STAGE_ACTIVE,
      toStageId: STAGE_DONE,
      display: 'primary' as const,
      intent: 'action' as const,
      sortOrder: 0,
      rules: { conditions: [], validators: [], postFunctions: [] },
    },
  ],
};

function makeEngine(subject: Partial<WorkflowActorSubject> = {}) {
  const adapter = {
    lock: vi.fn(async () => void 0),
    subject: vi.fn(async () => ({
      workflowId: 'wf',
      typeId: 'type',
      stageId: STAGE_ACTIVE,
      roles: new Set(['assignee']),
      bypassConditions: false,
      canOverrideGates: false,
      actsWithoutConditions: true,
      facts,
      ...subject,
    })),
    applyStage: vi.fn(async () => void 0),
    applyForm: vi.fn(async () => ({
      fields: { assignee: 'bob' },
      timeEntryId: null,
      result: null,
    })),
  };
  const registry = { get: vi.fn(() => adapter) };
  const workflows = { load: vi.fn(async () => structuredClone(simpleWorkflow)) };
  const records = { insert: vi.fn(async () => void 0) };
  return {
    engine: new WorkflowEngine(
      workflows as never,
      registry as never,
      records as never,
      { nextForType: vi.fn() } as never,
    ),
    adapter,
    workflows,
  };
}

describe('WorkflowEngine: approver_is_actor (#430)', () => {
  it('available: создатель видит сразу «Завершена»', async () => {
    const { engine, workflows } = makeEngine({
      roles: new Set(['creator']),
      actsWithoutConditions: false,
    });
    workflows.load.mockResolvedValueOnce(structuredClone(approvalWorkflow) as never);
    const buttons = await engine.available(TX as never, 't1', 'task', USER);
    expect(buttons.find((b) => b.id === SUBMIT)?.toStageId).toBe(STAGE_DONE);
  });

  it('available: соисполнитель видит «На утверждении»', async () => {
    const { engine, workflows } = makeEngine({
      roles: new Set(['coexecutor']),
      actsWithoutConditions: false,
    });
    workflows.load.mockResolvedValueOnce(structuredClone(approvalWorkflow) as never);
    const buttons = await engine.available(TX as never, 't1', 'task', USER);
    expect(buttons.find((b) => b.id === SUBMIT)?.toStageId).toBe(STAGE_REVIEW);
  });

  it('available: обход не делает админа утверждающим', async () => {
    const { engine, workflows } = makeEngine({
      roles: new Set(['assignee']),
      bypassConditions: true,
      actsWithoutConditions: false,
    });
    workflows.load.mockResolvedValueOnce(structuredClone(approvalWorkflow) as never);
    const buttons = await engine.available(TX as never, 't1', 'task', USER);
    expect(buttons.find((b) => b.id === SUBMIT)?.toStageId).toBe(STAGE_REVIEW);
  });
});

describe('WorkflowEngine: окно перехода (#430)', () => {
  it('окно не делает актора утверждающим — роли из subject0', async () => {
    const { engine, adapter, workflows } = makeEngine();
    const before = {
      workflowId: 'wf-approval',
      typeId: 'type',
      stageId: STAGE_ACTIVE,
      roles: new Set(['assignee']),
      bypassConditions: false,
      canOverrideGates: false,
      actsWithoutConditions: true,
      facts: { ...facts, assigneeId: 'bob' },
    };
    const after = {
      ...before,
      roles: new Set(['creator']),
      facts: { ...before.facts, assigneeId: USER.id },
    };
    adapter.subject.mockReset();
    adapter.subject.mockResolvedValueOnce(before as never).mockResolvedValueOnce(after as never);
    const withWindow = structuredClone(approvalWorkflow);
    Object.assign(
      withWindow.transitions.find((t) => t.id === SUBMIT)!,
      {
        form: { enabled: true, sections: [{ kind: 'fields', fields: ['assignee'] }] },
      },
    );
    workflows.load.mockResolvedValueOnce(withWindow as never);

    await engine.execute(
      TX as never,
      't1',
      'task',
      USER,
      { transitionId: SUBMIT },
      { form: { fields: { assigneeId: '00000000-0000-4000-8000-000000000021' } } },
    );

    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: STAGE_REVIEW }),
      USER.id,
      expect.anything(),
    );
  });

  it('legacy creator_is_assignee не обходится окном', async () => {
    const { engine, adapter, workflows } = makeEngine();
    const before = {
      workflowId: 'wf-approval',
      typeId: 'type',
      stageId: STAGE_ACTIVE,
      roles: new Set(['assignee']),
      bypassConditions: false,
      canOverrideGates: false,
      actsWithoutConditions: true,
      facts: { ...facts, creatorIsAssignee: false },
    };
    const after = {
      ...before,
      facts: { ...before.facts, creatorIsAssignee: true, assigneeId: USER.id },
    };
    adapter.subject.mockReset();
    adapter.subject.mockResolvedValueOnce(before as never).mockResolvedValueOnce(after as never);
    const legacy = structuredClone(approvalWorkflow);
    const submit = legacy.transitions.find((t) => t.id === SUBMIT)!;
    Object.assign(submit, {
      form: { enabled: true, sections: [{ kind: 'fields', fields: ['assignee'] }] },
      rules: {
        ...submit.rules,
        postFunctions: [{ kind: 'route_if', when: 'creator_is_assignee', toStageId: STAGE_DONE }],
      },
    });
    workflows.load.mockResolvedValueOnce(legacy as never);

    await engine.execute(
      TX as never,
      't1',
      'task',
      USER,
      { transitionId: SUBMIT },
      { form: { fields: { assigneeId: '00000000-0000-4000-8000-000000000021' } } },
    );

    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: STAGE_REVIEW }),
      USER.id,
      expect.anything(),
    );
  });

  it('окно «если ещё не списаны» не дублирует время', async () => {
    const { engine, adapter, workflows } = makeEngine({
      facts: { ...facts, spentMinutes: 10 },
    });
    const withTime = structuredClone(simpleWorkflow);
    Object.assign(withTime.transitions[0]!, {
      form: { enabled: true, sections: [{ kind: 'time', mode: 'if_empty' }] },
    });
    workflows.load.mockResolvedValueOnce(withTime as never);

    await engine.execute(
      TX as never,
      't1',
      'task',
      USER,
      { transitionId: TRANSITION },
      { form: { time: { minutes: 30, date: '2026-11-04' } } },
    );

    expect(adapter.applyForm).not.toHaveBeenCalled();
    expect(adapter.applyStage).toHaveBeenCalled();
  });

  it('выбор колонки по systemState', async () => {
    const { engine, adapter } = makeEngine();
    await engine.execute(TX as never, 't1', 'task', USER, { systemState: 'closed' });
    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: STAGE_DONE }),
      USER.id,
      expect.anything(),
    );
  });
});
