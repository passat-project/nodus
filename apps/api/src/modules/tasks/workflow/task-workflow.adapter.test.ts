import { describe, expect, it, vi } from 'vitest';
import { Permission } from '@nodus/contracts';

import { TaskWorkflowAdapter } from './task-workflow.adapter.js';

/** Адаптер задач для движка «Процессов» (ADR-0024): роли и флаги прав,
 *  смена стадии через StageMover, перенос/пересчёт публикации пачками с
 *  подготовкой личных маршрутов. БД мокается. */

const FROM = '00000000-0000-4000-8000-0000000000a1';
const TO = '00000000-0000-4000-8000-0000000000a2';
const TASK = '00000000-0000-4000-8000-0000000000b1';

const task = {
  id: TASK,
  number: 7,
  workflowId: '00000000-0000-4000-8000-0000000000f1',
  stageId: FROM,
  systemState: 'paused',
  creatorId: 'u1',
  assigneeId: 'u2',
  completedAt: null,
  participants: [{ userId: 'u3', role: 'coexecutor' }],
};

const facts = {
  stageId: FROM,
  acceptRequired: false,
  creatorIsAssignee: false,
  openSubtasks: 0,
  reviewSubtasks: 0,
  checklistDone: 0,
  checklistTotal: 0,
  spentMinutes: 0,
  description: '',
  deadline: null,
  assigneeId: 'u2',
  plannedMinutes: null,
  hasResult: false,
  resultMessageIds: [],
};

function makeAdapter() {
  const mover = { apply: vi.fn(async () => void 0), restate: vi.fn(async () => void 0) };
  const tasks = {
    lock: vi.fn(async () => void 0),
    findWithParticipants: vi.fn(async () => task),
    findLiveRoster: vi.fn(async () => task),
    idsByStage: vi.fn(),
    idsToRestate: vi.fn(),
    countByStages: vi.fn(async () => [
      { stageId: FROM, count: 2 },
      { stageId: TO, count: 0 },
    ]),
    updateFields: vi.fn(async () => void 0),
  };
  const factRepo = { gateFacts: vi.fn(async () => facts) };
  const placements = { prepare: vi.fn(async () => void 0) };
  const forms = { apply: vi.fn() };
  const messages = { countAttachments: vi.fn(async () => 0) };
  const customFields = { definitions: vi.fn(async () => []) };
  const deciders = {
    contextFor: vi.fn(async () => undefined),
    idsForStage: vi.fn(async () => [] as string[]),
    insertObserverIfAbsent: vi.fn(async () => false),
  };
  const events = { emit: vi.fn(async () => void 0) };
  const query = {
    customFieldsOf: vi.fn(async () => new Map([['parent', { f: 'P' }]])),
  };
  const projects = {
    numberContext: vi.fn(async () => ({
      projects: [
        {
          id: 'project',
          name: 'Дом',
          typeId: 'pt',
          portfolioId: 'pf',
          values: {},
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      nodes: [
        {
          id: 'node',
          name: 'КЖ-01',
          kindId: 'kind',
          projectId: 'project',
          parentId: null,
          values: {},
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    })),
  };
  const adapter = new TaskWorkflowAdapter(
    { run: vi.fn(async (fn: (t: unknown) => unknown) => fn({})) } as never,
    tasks as never,
    factRepo as never,
    placements as never,
    mover as never,
    forms as never,
    messages as never,
    customFields as never,
    { supplement: vi.fn(async (roles: Set<string>) => roles) } as never,
    deciders as never,
    events as never,
    query as never,
    projects as never,
    {
      submittableTransitionIds: vi.fn(async () => new Set<string>()),
      ensureForStage: vi.fn(async () => void 0),
    } as never,
  );
  return { adapter, mover, tasks, placements, deciders, events, query, projects };
}

describe('TaskWorkflowAdapter (#428, ADR-0024)', () => {
  it('категория — task (ключ реестра адаптеров)', () => {
    expect(TaskWorkflowAdapter.workflowCategory).toBe('task');
    expect(makeAdapter().adapter.category).toBe('task');
  });

  it('субъект: роли актора и флаги прав задачи', async () => {
    const { adapter } = makeAdapter();
    const subject = await adapter.subject({} as never, TASK, {
      id: 'u2',
      permissions: [Permission.TASK_MANAGE_ANY],
    });
    expect(subject.workflowId).toBe(task.workflowId);
    expect(subject.roles.has('assignee')).toBe(true);
    expect(subject.bypassConditions).toBe(true);
    expect(subject.canOverrideGates).toBe(false);
    expect(subject.actsWithoutConditions).toBe(true);
    const gateFacts = Object.fromEntries(
      Object.entries(facts).filter(([key]) => key !== 'resultMessageIds'),
    );
    expect(subject.facts).toMatchObject(gateFacts);
    expect(subject.facts.resultFileCount).toBe(0);
  });

  it('смена стадии — общий StageMover в транзакции вызывающего', async () => {
    const { adapter, mover } = makeAdapter();
    const target = { id: TO, name: 'В работе', systemState: 'active', outcome: null };
    await adapter.applyStage({} as never, TASK, target, 'u2', {
      transitionId: 'tr',
      cause: 'transition',
    });
    expect(mover.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: TASK }),
      target,
      'u2',
      { transitionId: 'tr', cause: 'transition' },
    );
  });

  it('решающий после нажатия — наблюдатель без звука и событие состава (#433)', async () => {
    const { adapter, mover, deciders, events } = makeAdapter();
    deciders.insertObserverIfAbsent.mockResolvedValue(true);
    const target = { id: TO, name: 'Готово', systemState: 'closed', outcome: 'success' };
    await adapter.applyStage({} as never, TASK, target, 'u9', {
      transitionId: 'tr',
      cause: 'transition',
      wasDeciderOfTransition: true,
    } as never);
    expect(mover.apply).toHaveBeenCalled();
    expect(deciders.insertObserverIfAbsent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: TASK }),
      'u9',
    );
    expect(events.emit).toHaveBeenCalledWith(
      {},
      'task.participants_changed',
      expect.objectContaining({ added: [{ userId: 'u9', role: 'observer' }] }),
      expect.objectContaining({ actorId: 'u9' }),
    );
  });

  it('не решающий — наблюдателем не становится', async () => {
    const { adapter, deciders } = makeAdapter();
    await adapter.applyStage(
      {} as never,
      TASK,
      { id: TO, name: 'Готово', systemState: 'closed', outcome: 'success' },
      'u9',
      {
        transitionId: 'tr',
        cause: 'transition',
      } as never,
    );
    expect(deciders.insertObserverIfAbsent).not.toHaveBeenCalled();
  });

  it('счётчики по стадиям', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.countByStages([FROM, TO])).resolves.toEqual({ [FROM]: 2, [TO]: 0 });
    await expect(adapter.countByStages([])).resolves.toEqual({});
  });

  it('перенос: пачка задач → StageMover cause=workflow_migration; повтор — пусто', async () => {
    const made = makeAdapter();
    made.tasks.idsByStage.mockResolvedValueOnce([{ id: TASK }]).mockResolvedValue([]);
    const target = { id: TO, name: 'В работе', systemState: 'active', outcome: null };
    await expect(made.adapter.migrateStage(FROM, target)).resolves.toBe(1);
    expect(made.mover.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: TASK }),
      target,
      null,
      { transitionId: null, cause: 'workflow_migration' },
    );
    // Личные маршруты держателей — до транзакции (постановщик, исполнитель, соисполнитель).
    expect(made.placements.prepare).toHaveBeenCalledWith(['u1', 'u2', 'u3']);
    await expect(made.adapter.migrateStage(FROM, target)).resolves.toBe(0);
  });

  it('смена группы статуса: StageMover.restate каждой задаче («Мой план» переезжает)', async () => {
    const made = makeAdapter();
    made.tasks.idsToRestate.mockResolvedValueOnce([{ id: TASK }]).mockResolvedValue([]);
    await expect(made.adapter.restateStage(FROM, 'active')).resolves.toBe(1);
    expect(made.mover.restate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: TASK }),
      'active',
    );
  });
});

it('numberTarget: конфиденциальный родитель не раскрывается; applyNumbers пишет номер', async () => {
  const { adapter, tasks, events } = makeAdapter();
  const parent = {
    ...task,
    id: 'parent',
    confidential: true,
    participants: [{ userId: 'u3' }],
  };
  const child = {
    ...task,
    typeId: 'type',
    nodeId: 'node',
    projectId: 'project',
    parentId: 'parent',
    customFields: { f: 'Изм. 1' },
  };
  tasks.findWithParticipants = vi.fn(async (id: string) =>
    id === 'parent' ? parent : child,
  ) as never;
  const target = await adapter.numberTarget({} as never, TASK, { id: 'u4', permissions: [] });
  expect(target).toMatchObject({ host: 'task', projectId: 'project' });
  expect(target.sources.parentTask).toBeNull();
  const participant = await adapter.numberTarget({} as never, TASK, {
    id: 'u3',
    permissions: [],
  });
  expect(participant.sources.parentTask).toMatchObject({ f: 'P' });
  await adapter.applyNumbers({} as never, TASK, 'u2', { f: 'Изм. 2' });
  expect(tasks.updateFields).toHaveBeenCalled();
  expect(events.emit).toHaveBeenCalled();
});
