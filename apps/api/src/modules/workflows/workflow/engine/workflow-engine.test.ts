import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';

import type {
  WorkflowActor,
  WorkflowActorSubject,
} from '../../../../core/ports/workflow-entity.port.js';
import { WorkflowEngine } from './workflow-engine.js';

/** Движок «Процессов» с поддельным адаптером (ADR-0024): кнопки несут показ
 *  и итог цели, условия «кто» решает субъект адаптера, обход гейта требует
 *  флага адаптера и причины, смена стадии уходит в адаптер в той же tx. */

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
      rules: { conditions: [], validators: [], postFunctions: [] },
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
  const workflows = { load: vi.fn(async () => structuredClone(workflow)) };
  const records = { insert: vi.fn(async () => void 0) };
  const numbers = { nextForType: vi.fn() };
  return {
    engine: new WorkflowEngine(
      workflows as never,
      registry as never,
      records as never,
      numbers as never,
    ),
    adapter,
    registry,
    workflows,
    records,
    numbers,
  };
}

describe('WorkflowEngine (#428, ADR-0024)', () => {
  it('available: кнопки несут показ и итог цели, замок не берётся', async () => {
    const { engine, adapter } = makeEngine();
    const buttons = await engine.available(TX as never, 't1', 'task', USER);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({
      display: 'primary',
      toStageOutcome: 'success',
      toStageState: 'closed',
    });
    expect(adapter.lock).not.toHaveBeenCalled();
  });

  it('execute: замок → субъект → смена стадии адаптером в той же tx', async () => {
    const { engine, adapter } = makeEngine();
    await engine.execute(TX as never, 't1', 'task', USER, { transitionId: TRANSITION });
    expect(adapter.lock).toHaveBeenCalledWith(TX, 't1');
    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: STAGE_DONE }),
      'bob',
      expect.objectContaining({ transitionId: TRANSITION, cause: 'transition' }),
    );
  });

  it('execute: assign_number выдаёт номер до смены стадии', async () => {
    const { engine, adapter, workflows, numbers } = makeEngine();
    numbers.nextForType.mockResolvedValueOnce({ display: 'T-1' } as never);
    const numbered = structuredClone(workflow);
    numbered.transitions[0]!.rules = {
      conditions: [],
      validators: [],
      postFunctions: [{ kind: 'assign_number' }],
    } as never;
    workflows.load.mockResolvedValueOnce(numbered);

    await engine.execute(TX as never, 't1', 'task', USER, { transitionId: TRANSITION });

    expect(numbers.nextForType).toHaveBeenCalledWith(TX, 'type');
    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: STAGE_DONE }),
      USER.id,
      expect.objectContaining({ numbering: { display: 'T-1' } }),
    );
  });

  it('обход гейта: причина уходит в адаптер (история/аудит, ADR-0020)', async () => {
    const { engine, adapter, workflows } = makeEngine({ canOverrideGates: true });
    const gated = structuredClone(workflow);
    gated.transitions[0]!.rules = {
      conditions: [],
      validators: [{ kind: 'result_present' }],
      postFunctions: [],
    } as never;
    workflows.load.mockResolvedValueOnce(gated);
    await engine.execute(
      TX as never,
      't1',
      'task',
      { id: 'bob', permissions: ['task.override_gate'] },
      { transitionId: TRANSITION },
      { override: true, reason: '  срочно  ' },
    );
    expect(adapter.applyStage).toHaveBeenCalledWith(
      TX,
      't1',
      expect.objectContaining({ id: STAGE_DONE }),
      'bob',
      expect.objectContaining({
        cause: 'transition',
        overriddenGates: ['result_present'],
        overrideReason: 'срочно',
      }),
    );
  });

  it('гейт не пройден без обхода — 409 WORKFLOW_TRANSITION_BLOCKED', async () => {
    const { engine, workflows } = makeEngine();
    const gated = structuredClone(workflow);
    gated.transitions[0]!.rules = {
      conditions: [],
      validators: [{ kind: 'result_present' }],
      postFunctions: [],
    } as never;
    workflows.load.mockResolvedValueOnce(gated);
    await expect(
      engine.execute(TX as never, 't1', 'task', USER, { transitionId: TRANSITION }),
    ).rejects.toMatchObject({ code: ErrorCode.WORKFLOW_TRANSITION_BLOCKED });
  });

  it('условие permission: available и execute согласованы (права актора — в обоих)', async () => {
    const { engine, adapter, workflows } = makeEngine({
      roles: new Set(),
      actsWithoutConditions: false,
    });
    const gated = structuredClone(workflow);
    gated.transitions[0]!.rules = {
      conditions: [{ kind: 'permission', permission: Permission.TASK_MANAGE_ANY }],
      validators: [],
      postFunctions: [],
    } as never;
    workflows.load.mockResolvedValue(gated);
    const actor = { id: 'bob', permissions: [Permission.TASK_MANAGE_ANY] };
    await expect(engine.available(TX as never, 't1', 'task', actor)).resolves.toHaveLength(1);
    await expect(
      engine.execute(TX as never, 't1', 'task', actor, { transitionId: TRANSITION }),
    ).resolves.toMatchObject({ stage: { id: STAGE_DONE } });
    expect(adapter.applyStage).toHaveBeenCalled();
  });

  it('колонка «Итог» не подменяет итог: заблокированная «Завершить» не уходит в «Отмену» (#402)', async () => {
    const { engine, adapter, workflows } = makeEngine();
    const gated = structuredClone(workflow);
    const cancelledStage = '00000000-0000-4000-8000-000000000002';
    gated.stages.push({
      id: cancelledStage,
      code: 'cancelled',
      name: 'Отменена',
      systemState: 'closed',
      archivedAt: null,
      workflowId: 'wf',
      color: 'danger',
      sortOrder: 2,
      isInitial: false,
      outcome: 'cancelled',
    } as never);
    gated.transitions.push({
      id: '00000000-0000-4000-8000-000000000012',
      name: 'Отменить',
      fromStageId: STAGE_ACTIVE,
      toStageId: cancelledStage,
      display: 'button',
      sortOrder: 1,
      rules: { conditions: [], validators: [], postFunctions: [] },
    } as never);
    gated.transitions[0]!.rules = {
      conditions: [],
      validators: [{ kind: 'result_present' }],
      postFunctions: [],
    } as never;
    workflows.load.mockResolvedValue(gated);

    await expect(
      engine.execute(TX as never, 't1', 'task', USER, {
        systemState: 'closed',
        outcome: 'success',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.WORKFLOW_TRANSITION_BLOCKED });
    expect(adapter.applyStage).not.toHaveBeenCalled();

    // Та же колонка, но итог «отменена» — своя кнопка, подмена не нужна.
    await expect(
      engine.execute(TX as never, 't1', 'task', USER, {
        systemState: 'closed',
        outcome: 'cancelled',
      }),
    ).resolves.toMatchObject({ stage: { id: cancelledStage, outcome: 'cancelled' } });
  });

  it('нет перехода из статуса — 409 WORKFLOW_TRANSITION_NOT_ALLOWED', async () => {
    const { engine } = makeEngine();
    await expect(
      engine.execute(TX as never, 't1', 'task', USER, { stageId: STAGE_ACTIVE }),
    ).rejects.toMatchObject({ code: ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED });
  });
});
