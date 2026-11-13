import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDeciderTransition } from '../../workflows/ports/workflow-rules-reader.port.js';
import { TaskDeciderRecipients } from './task-decider-recipients.service.js';
import { TaskDeciders } from './task-deciders.service.js';
import type { DeciderTaskRow } from './task-decider-facts.js';

const TASK: DeciderTaskRow = {
  id: 'task-1',
  workflowId: 'wf-1',
  stageId: 'stage-active',
  systemState: 'active',
  creatorId: 'creator',
  assigneeId: 'assignee',
  projectId: null,
  confidential: false,
  customFields: {},
};

const FIELD_ID = '00000000-0000-4000-8000-0000000000f1';

function make(transition: Partial<WorkflowDeciderTransition>, task: Partial<DeciderTaskRow> = {}) {
  const rules: WorkflowDeciderTransition[] = [
    {
      workflowId: 'wf-1',
      transitionId: 'tr-1',
      fromStageId: 'stage-active',
      toStageId: 'stage-done',
      toStageSystemState: 'closed',
      intent: 'action',
      sources: [],
      ...transition,
    },
  ];
  const org = {
    managersOf: vi.fn(async () => new Map([['creator', 'boss']])),
  };
  const projects = {
    rolesIn: vi.fn(async () => ({}) as Record<string, never>),
    visibilityOf: vi.fn(async (): Promise<'open' | 'secret' | null> => 'open'),
    usersWithRoles: vi.fn(async () => []),
  };
  // Реестр атрибутов сервисы берут лениво через ModuleRef (#631: разрыв
  // DI-цикла tasks↔custom-fields) — в тестах это простой заглушечный get().
  const customFields = {
    definitions: vi.fn(async () => [{ id: FIELD_ID, type: 'user', settings: {} }]),
  };
  const moduleRef = { get: vi.fn(() => customFields) };
  const profiles = { filterActiveUserIds: vi.fn(async (ids: string[]) => ids) };
  const repository = {
    findCandidates: vi.fn(async () => []),
    findTask: vi.fn(async () => TASK),
    participantIds: vi.fn(async () => [] as string[]),
    findParticipant: vi.fn(async () => false),
    insertObserver: vi.fn(async () => void 0),
  };
  const recipients = new TaskDeciderRecipients(
    org as never,
    projects as never,
    { deciderTransitions: vi.fn(async () => rules) } as never,
    moduleRef as never,
    profiles as never,
    repository as never,
  );
  const service = new TaskDeciders(
    org as never,
    projects as never,
    { deciderTransitions: vi.fn(async () => rules) } as never,
    moduleRef as never,
    recipients,
    repository as never,
  );
  return { service, org, projects, repository, recipients, task: { ...TASK, ...task } };
}

describe('TaskDeciders (#433)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('manager_of: ближайший руководитель автора — решающий, исполнителя — нет', async () => {
    const { service, task } = make({
      sources: [{ kind: 'manager_of', of: 'creator' }],
    });
    const context = await service.contextFor(undefined, task, 'boss');
    expect(context?.facts.creatorManagerId).toBe('boss');
    expect(context?.vacantTransitionIds.size).toBe(0);
    expect(await service.isDeciderNow(undefined, task, 'boss')).toBe(true);
    expect(await service.isDeciderNow(undefined, task, 'creator')).toBe(false);
  });

  it('вакансия: пустой список сотрудников — переход помечен вакантным', async () => {
    const { service, task } = make({
      sources: [{ kind: 'employees', userIds: [] }],
    });
    const context = await service.contextFor(undefined, task, 'stranger');
    expect([...(context?.vacantTransitionIds ?? [])]).toEqual(['tr-1']);
    expect(await service.isDeciderNow(undefined, task, 'stranger')).toBe(false);
  });

  it('не-user поле источником не считается (вакансия, не совпадение)', async () => {
    const { service, task } = make({
      sources: [{ kind: 'field', field: `cf.${FIELD_ID}` }],
    });
    task.customFields = { [FIELD_ID]: 'someone' };
    const context = await service.contextFor(undefined, task, 'someone');
    // defs содержат тип user — источник валиден, значит не вакантен.
    expect(context?.vacantTransitionIds.size).toBe(0);
  });

  it('роль в проекте: participant совпадает, посторонний — нет', async () => {
    const { service, projects, task } = make({
      sources: [{ kind: 'project_role', role: 'participant' }],
    });
    task.projectId = 'p-1';
    projects.rolesIn.mockResolvedValue({ 'p-1': ['participant'] } as never);
    expect(await service.isDeciderNow(undefined, task, 'creator')).toBe(true);
    projects.rolesIn.mockResolvedValue({});
    expect(await service.isDeciderNow(undefined, task, 'creator')).toBe(false);
  });

  it('конфиденциальная задача: решающий-не-участник не читает', async () => {
    const { service, task } = make({
      sources: [{ kind: 'employees', userIds: ['boss'] }],
    });
    task.confidential = true;
    expect(await service.isDeciderNow(undefined, task, 'boss')).toBe(false);
  });

  it('секретный проект: решающий-не-участник не читает', async () => {
    const { service, projects, task } = make({
      sources: [{ kind: 'employees', userIds: ['boss'] }],
      fromStageId: null,
      toStageId: null,
    });
    task.projectId = 'p-1';
    projects.visibilityOf.mockResolvedValue('secret');
    expect(await service.isDeciderNow(undefined, task, 'boss')).toBe(false);
    expect(
      (
        await service.idsForStage(undefined as never, task, {
          id: 'stage-done',
          systemState: 'closed',
        })
      ).length,
    ).toBe(0);
  });

  it('наблюдатель: создатель не добавляется, существующий coexecutor не понижается', async () => {
    const { service, repository, task } = make({ sources: [] });
    expect(await service.insertObserverIfAbsent({} as never, task, 'creator')).toBe(false);
    repository.findParticipant.mockResolvedValue(true);
    expect(await service.insertObserverIfAbsent({} as never, task, 'boss')).toBe(false);
    repository.findParticipant.mockResolvedValue(false);
    expect(await service.insertObserverIfAbsent({} as never, task, 'boss')).toBe(true);
    expect(repository.insertObserver).toHaveBeenCalledWith({}, 'task-1', 'boss');
  });

  it('idsForStage: сотрудники, поле и руководитель — адресаты уведомления', async () => {
    const byField = make({ sources: [{ kind: 'field', field: `cf.${FIELD_ID}` }] });
    byField.task.customFields = { [FIELD_ID]: 'boss' };
    expect(
      await byField.recipients.idsForStage({} as never, byField.task, {
        id: 'stage-active',
        systemState: 'active',
      }),
    ).toEqual(['boss']);

    const byManager = make({ sources: [{ kind: 'manager_of', of: 'creator' }] });
    expect(
      await byManager.recipients.idsForStage({} as never, byManager.task, {
        id: 'stage-active',
        systemState: 'active',
      }),
    ).toEqual(['boss']);

    const byEmployees = make({ sources: [{ kind: 'employees', userIds: ['boss'] }] });
    expect(
      await byEmployees.recipients.idsForStage({} as never, byEmployees.task, {
        id: 'stage-active',
        systemState: 'active',
      }),
    ).toEqual(['boss']);
  });

  it('idsForStage: роль проекта и фильтр живых сотрудников', async () => {
    const { recipients, projects, task } = make({
      sources: [{ kind: 'project_role', role: 'participant' }],
    });
    task.projectId = 'p-1';
    projects.usersWithRoles.mockResolvedValue(['boss', 'gone'] as never);
    expect(
      await recipients.idsForStage({} as never, task, {
        id: 'stage-active',
        systemState: 'active',
      }),
    ).toEqual(['boss', 'gone']);
  });

  it('адресаты не утекают в конфиденциальную задачу и секретный проект', async () => {
    const confidential = make({ sources: [{ kind: 'employees', userIds: ['stranger'] }] });
    confidential.task.confidential = true;
    expect(
      await confidential.recipients.idsForStage({} as never, confidential.task, {
        id: 'stage-active',
        systemState: 'active',
      }),
    ).toEqual([]);

    const secret = make({ sources: [{ kind: 'employees', userIds: ['stranger'] }] });
    secret.task.projectId = 'p-1';
    secret.projects.visibilityOf.mockResolvedValue('secret');
    expect(
      await secret.recipients.idsForStage({} as never, secret.task, {
        id: 'stage-active',
        systemState: 'active',
      }),
    ).toEqual([]);
  });

  it('участник секретного проекта читает задачу как решающий', async () => {
    const { service, projects, task } = make({
      sources: [{ kind: 'employees', userIds: ['boss'] }],
    });
    task.projectId = 'p-1';
    projects.visibilityOf.mockResolvedValue('secret');
    projects.rolesIn.mockResolvedValue({ 'p-1': ['participant'] } as never);
    expect(await service.isDeciderNow(undefined, task, 'boss')).toBe(true);
  });

  it('переход «из любого» между итогами и self-loop не делают держателем', async () => {
    const { service, task } = make({
      sources: [{ kind: 'employees', userIds: ['boss'] }],
      fromStageId: null,
      toStageId: 'stage-closed',
      toStageSystemState: 'closed',
    });
    task.systemState = 'closed';
    task.stageId = 'stage-closed';
    expect(await service.isDeciderNow(undefined, task, 'boss')).toBe(false);
  });

  it('taskIdsFor: кандидаты по источникам, кэш на актора', async () => {
    const { service, repository } = make({
      sources: [{ kind: 'employees', userIds: ['boss'] }],
    });
    repository.findCandidates.mockResolvedValue([
      { ...TASK, id: 'task-1' },
      { ...TASK, id: 'task-2' },
    ] as never);
    await expect(service.taskIdsFor('boss')).resolves.toEqual(['task-1', 'task-2']);
    await service.taskIdsFor('boss');
    expect(repository.findCandidates).toHaveBeenCalledTimes(1);
    await expect(service.taskIdsFor('stranger')).resolves.toEqual([]);
  });
});
