import { describe, expect, it, vi } from 'vitest';
import type {
  WorkflowActor,
  WorkflowActorSubject,
} from '../../../../core/ports/workflow-entity.port.js';
import { WorkflowEngine } from './workflow-engine.js';

/** Движок «Процессов» на поддельном адаптере: только ветка решающих (#433). */

const TX = { tx: true };
const STAGE_ACTIVE = '00000000-0000-4000-8000-000000000001';
const STAGE_DONE = '00000000-0000-4000-8000-000000000003';
const TRANSITION = '00000000-0000-4000-8000-000000000011';
const USER: WorkflowActor = { id: 'bob', permissions: [] };

const workflow = {
  id: 'wf',
  stages: [
    {
      id: STAGE_ACTIVE,
      code: null,
      name: 'В работе',
      systemState: 'active',
      archivedAt: null,
      workflowId: 'wf',
      color: 'success',
      sortOrder: 0,
      isInitial: false,
      outcome: null,
    },
    {
      id: STAGE_DONE,
      code: null,
      name: 'Завершена',
      systemState: 'closed',
      archivedAt: null,
      workflowId: 'wf',
      color: 'info',
      sortOrder: 1,
      isInitial: false,
      outcome: 'success',
    },
  ],
  transitions: [
    {
      id: TRANSITION,
      name: 'Завершить',
      fromStageId: STAGE_ACTIVE,
      toStageId: STAGE_DONE,
      display: 'primary' as const,
      intent: 'action' as const,
      sortOrder: 0,
      rules: {
        conditions: [{ kind: 'decider_in', source: { kind: 'employees', userIds: ['alice'] } }],
        validators: [],
        postFunctions: [],
      },
    },
  ],
};

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

const deciderFacts = (userId: string) => ({
  userId,
  creatorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  assigneeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  creatorManagerId: null,
  assigneeManagerId: null,
  positionKeys: new Set<string>(),
  projectRoles: new Set<never>(),
  fieldUserIds: {},
  userFieldIds: new Set<string>(),
});

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
      actsWithoutConditions: false,
      facts,
      ...subject,
    })),
    applyStage: vi.fn(async () => void 0),
    applyForm: vi.fn(async () => ({ fields: {}, timeEntryId: null, result: null })),
  };
  const registry = { get: vi.fn(() => adapter) };
  const workflows = { load: vi.fn(async () => structuredClone(workflow)) };
  const records = { insert: vi.fn(async () => void 0) };
  return {
    engine: new WorkflowEngine(
      workflows as never,
      registry as never,
      records as never,
      { nextForType: vi.fn() } as never,
      { plan: vi.fn(async () => ({ ok: true, issue: async () => ({}) })) } as never,
    ),
    adapter,
    workflows,
  };
}

describe('WorkflowEngine — решающие (#433)', () => {
  it('источник не совпал — кнопки нет', async () => {
    const { engine } = makeEngine({ deciderFacts: deciderFacts('bob') });
    expect(await engine.available(TX as never, 't1', 'task', USER)).toHaveLength(0);
  });

  it('источник совпал — кнопка видна и переход проходит с флагом решающего', async () => {
    const { engine, adapter, workflows } = makeEngine({ deciderFacts: deciderFacts('bob') });
    (workflow.transitions[0]!.rules as never as { conditions: unknown[] }).conditions = [
      { kind: 'decider_in', source: { kind: 'employees', userIds: ['bob'] } },
    ];
    workflows.load.mockImplementation(async () => structuredClone(workflow));
    expect(await engine.available(TX as never, 't1', 'task', USER)).toHaveLength(1);
    await engine.execute(TX as never, 't1', 'task', USER, { transitionId: TRANSITION });
    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: STAGE_DONE }),
      'bob',
      expect.objectContaining({ wasDeciderOfTransition: true }),
    );
  });

  it('вакансия: без права обхода кнопки нет, с правом — блок и причина', async () => {
    const noOverride = makeEngine({
      bypassConditions: true,
      canOverrideGates: false,
      vacantDeciderTransitionIds: new Set([TRANSITION]),
    });
    noOverride.workflows.load.mockResolvedValue(structuredClone(workflow));
    expect(await noOverride.engine.available(TX as never, 't1', 'task', USER)).toHaveLength(0);

    const { engine, workflows, adapter } = makeEngine({
      bypassConditions: true,
      canOverrideGates: true,
      vacantDeciderTransitionIds: new Set([TRANSITION]),
    });
    workflows.load.mockResolvedValue(structuredClone(workflow));
    const buttons = await engine.available(TX as never, 't1', 'task', USER);
    expect(buttons[0]!.blockedBy).toEqual([{ kind: 'decider_vacant' }]);

    await expect(
      engine.execute(TX as never, 't1', 'task', USER, { transitionId: TRANSITION }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_TRANSITION_BLOCKED' });

    await engine.execute(
      TX as never,
      't1',
      'task',
      USER,
      { transitionId: TRANSITION },
      { override: true, reason: 'зам в отпуске' },
    );
    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: STAGE_DONE }),
      'bob',
      expect.objectContaining({ overriddenGates: ['decider_vacant'] }),
    );
  });

  it('актор проходит по другому условию — вакансия не блокирует', async () => {
    const { engine, workflows } = makeEngine({
      vacantDeciderTransitionIds: new Set([TRANSITION]),
    });
    const doc = structuredClone(workflow);
    (doc.transitions[0]!.rules as never as { conditions: unknown[] }).conditions = [
      { kind: 'role_in', roles: ['assignee'] },
      { kind: 'decider_in', source: { kind: 'employees', userIds: ['alice'] } },
    ];
    workflows.load.mockResolvedValue(doc);
    const buttons = await engine.available(TX as never, 't1', 'task', USER);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.blockedBy).toEqual([]);
  });
});
