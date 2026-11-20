import { describe, expect, it, vi } from 'vitest';

import { PressAdminService } from './press-admin.service.js';

const TASK = {
  id: 't1',
  number: 17,
  title: 'Проверить раздел',
  projectId: null,
  stageId: 's1',
  creatorId: 'creator',
  assigneeId: 'assignee',
  participants: [],
};

const entry = (state: string, id = 'e1', userId = 'u1', order = 0) => ({
  id,
  roundId: 'r1',
  userId,
  order,
  state,
  pressedAt: null,
  input: null,
  result: null,
  timeEntryId: null,
  returnReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function setup(state = 'pressed') {
  const round = {
    id: 'r1',
    entityKind: 'task',
    entityId: 't1',
    stageId: 's1',
    transitionId: 'tr1',
    transitionName: 'Завершить',
    cycle: 1,
    config: {
      sources: [{ kind: 'coexecutors' }],
      quorum: { kind: 'all' },
      order: 'parallel',
      excludeAuthor: true,
    },
    form: { enabled: true, sections: [{ kind: 'result' }] },
    startedAt: new Date(),
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    entries: [entry(state)],
  };
  const repo = {
    findOpenRound: vi.fn(async () => round),
    updateEntry: vi.fn(async (_tx, id, data) => ({ id, ...data })),
    completeRound: vi.fn(async () => ({ ...round, completedAt: new Date() })),
  };
  const view = { id: 'r1', pressed: 1, total: 1 } as never;
  const rounds = { viewForTask: vi.fn(async () => view) };
  const tasks = {
    lock: vi.fn(async () => void 0),
    findWithParticipants: vi.fn(async () => TASK),
  };
  const records = { write: vi.fn(async () => void 0) };
  const pressEvents = {
    isBroadcast: () => false,
    updated: vi.fn(async () => void 0),
    returned: vi.fn(async () => void 0),
  };
  const service = new PressAdminService(
    { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } as never,
    repo as never,
    rounds as never,
    tasks as never,
    { lockProject: vi.fn() } as never,
    records as never,
    pressEvents as never,
  );
  return { service, repo, rounds, tasks, records, pressEvents, round };
}

describe('PressAdminService (#434)', () => {
  it('возврат: нажатая отметка → returned, причина и журнал', async () => {
    const { service, repo, records, pressEvents, round } = setup('pressed');
    repo.findOpenRound.mockResolvedValue({
      ...round,
      entries: [entry('pressed', 'e1', 'assignee')],
    });
    await service.returnEntries({ id: 'assignee', permissions: [] } as never, 't1', {
      userIds: ['assignee'],
      reason: 'Доработать раздел',
    });
    expect(repo.updateEntry).toHaveBeenCalledWith(
      expect.anything(),
      'e1',
      expect.objectContaining({ state: 'returned', returnReason: 'Доработать раздел' }),
    );
    expect(records.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordKind: 'return', participantId: 'assignee' }),
    );
    expect(pressEvents.returned).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'assignee',
      expect.anything(),
      ['assignee'],
      'Доработать раздел',
      false,
    );
  });

  it('возврат чужих отметок — только ответственный/право правки', async () => {
    const { service } = setup('pressed');
    await expect(
      service.returnEntries({ id: 'u1', permissions: [] } as never, 't1', {
        userIds: ['assignee'],
        reason: 'Причина',
      }),
    ).rejects.toThrow();
  });

  it('возврат без нажатых отметок — ошибка валидации', async () => {
    const { service, round } = setup('waiting');
    await expect(
      service.returnEntries({ id: 'assignee', permissions: [] } as never, 't1', {
        userIds: ['assignee'],
        reason: 'Причина',
      }),
    ).rejects.toThrow();
    expect(round.entries[0]?.state).toBe('waiting');
  });
});
