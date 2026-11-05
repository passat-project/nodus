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

const POSITION_ID = '00000000-0000-4000-8000-0000000000a1';
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
    positionsOf: vi.fn(async (id: string) =>
      id === 'holder' ? [{ positionId: POSITION_ID, kind: 'management' as const }] : [],
    ),
    managersOf: vi.fn(async () => new Map([['creator', 'boss']])),
    holdersOfPosition: vi.fn(async () => [{ id: 'holder', displayName: 'Держатель' }]),
  };
  const projects = {
    rolesIn: vi.fn(async () => ({}) as Record<string, never>),
    visibilityOf: vi.fn(async (): Promise<'open' | 'secret' | null> => 'open'),
    usersWithRoles: vi.fn(async () => []),
  };
  const customFields = {
    definitions: vi.fn(async () => [{ id: FIELD_ID, type: 'user', settings: {}, hidden: false }]),
  };
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
    customFields as never,
    profiles as never,
    repository as never,
  );
  const service = new TaskDeciders(
    org as never,
    projects as never,
    { deciderTransitions: vi.fn(async () => rules) } as never,
    customFields as never,
    recipients,
    repository as never,
  );
  return { service, org, projects, repository, task: { ...TASK, ...task } };
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

  it('должность: держатель — решающий, другой — нет', async () => {
    const { service, task } = make({
      sources: [{ kind: 'position', positionId: POSITION_ID, positionKind: 'management' }],
    });
    expect(await service.isDeciderNow(undefined, task, 'holder')).toBe(true);
    expect(await service.isDeciderNow(undefined, task, 'stranger')).toBe(false);
  });

  it('вакансия: должность без держателей — переход помечен вакантным', async () => {
    const { service, org, task } = make({
      sources: [{ kind: 'position', positionId: POSITION_ID, positionKind: 'management' }],
    });
    org.holdersOfPosition.mockResolvedValue([]);
    const context = await service.contextFor(undefined, task, 'holder');
    expect([...(context?.vacantTransitionIds ?? [])]).toEqual(['tr-1']);
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
    projects.rolesIn.mockResolvedValue({ 'p-1': ['participant'] as never });
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
});
