import { describe, expect, it, vi } from 'vitest';

import { PressRoundsService } from './press-rounds.service.js';

/** Жизненный цикл раунда (#434, решения владельца 11.11.2026): пауза
 *  сохраняет прогресс, завершённый раунд читается, пустые источники дают
 *  статус для блокировки закрывающего перехода. */

const TASK = {
  id: 't1',
  number: 1,
  title: 'Задача',
  workflowId: 'wf1',
  stageId: 's1',
  systemState: 'active',
  creatorId: 'creator',
  assigneeId: 'assignee',
  projectId: null,
  confidential: false,
  customFields: {},
  participants: [],
};

const ROUND = {
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
  form: { enabled: false, sections: [] },
  startedAt: new Date(),
  completedAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  entries: [
    {
      id: 'e1',
      roundId: 'r1',
      userId: 'u1',
      order: 0,
      state: 'pressed',
      pressedAt: new Date(),
      input: { result: { text: 'Готово', messageIds: [] } },
      result: { text: 'Готово', messageIds: [], fileCount: 0, minutes: null, date: null },
      timeEntryId: null,
      returnReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
};

function setup() {
  const repo = {
    findOpenRound: vi.fn(async () => ROUND),
    findLatestCompletedRound: vi.fn(async () => ({ ...ROUND, completedAt: new Date() })),
    findLatestRoundForUser: vi.fn(async () => ({ ...ROUND, completedAt: new Date() })),
    cancelOpenRound: vi.fn(async () => void 0),
    createRound: vi.fn(async () => ROUND),
    nextCycle: vi.fn(async () => 1),
  };
  const sources = { resolve: vi.fn(async () => [{ userId: 'u1', order: 0 }]) };
  const tasks = {
    lock: vi.fn(async () => void 0),
    findWithParticipants: vi.fn(async () => TASK),
  };
  const pressReader = {
    pressTransitionsForStage: vi.fn(async () => [
      { id: 'tr1', name: 'Завершить', sortOrder: 0, press: ROUND.config, form: ROUND.form },
    ]),
  };
  const users = { findRefs: vi.fn(async () => [{ id: 'u1', displayName: 'Иван' }]) };
  const events = { emit: vi.fn(async () => void 0) };
  const pressEvents = {
    updated: vi.fn(async () => void 0),
    completionBlocked: vi.fn(async () => void 0),
  };
  const records = { write: vi.fn(async () => void 0) };
  const service = new PressRoundsService(
    repo as never,
    sources as never,
    tasks as never,
    { lockProject: vi.fn() } as never,
    events as never,
    pressEvents as never,
    pressReader as never,
    users as never,
    records as never,
  );
  return { service, repo, sources, tasks, pressReader, events, pressEvents, records };
}

describe('PressRoundsService (#434)', () => {
  it('пауза сохраняет открытый раунд: не отменяет и не создаёт новый', async () => {
    const { service, repo, tasks } = setup();
    tasks.findWithParticipants.mockResolvedValue({ ...TASK, systemState: 'paused' });

    const state = await service.ensureForStage({} as never, 't1');

    expect(state).toEqual({ transitionId: null, roundStarted: true, emptySources: false });
    expect(repo.cancelOpenRound).not.toHaveBeenCalled();
    expect(repo.createRound).not.toHaveBeenCalled();
  });

  it('возврат в статус: выбранные — returned, остальные сохраняют отметки (В2)', async () => {
    const { service, repo, events } = setup();
    repo.findOpenRound.mockResolvedValueOnce(null as never);
    repo.findLatestCompletedRound.mockResolvedValueOnce({
      ...ROUND,
      completedAt: new Date(),
      entries: [
        { ...ROUND.entries[0]! },
        { ...ROUND.entries[0]!, id: 'e2', userId: 'u2', order: 1 },
        {
          ...ROUND.entries[0]!,
          id: 'e3',
          userId: 'u3',
          order: 2,
          state: 'excluded',
          pressedAt: null,
          input: null,
          result: null,
        },
        {
          ...ROUND.entries[0]!,
          id: 'e4',
          userId: 'u4',
          order: 3,
          state: 'waiting',
          pressedAt: null,
          input: null,
          result: null,
        },
      ],
    } as never);

    const state = await service.ensureForStage({} as never, 't1', {
      notify: true,
      returnUserIds: ['u1'],
    });

    expect(state.roundStarted).toBe(true);
    const calls = repo.createRound.mock.calls as unknown as [
      unknown,
      { entries: { userId: string; state: string }[] },
    ][];
    const created = calls[0]?.[1];
    expect(created?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'u1', state: 'returned' }),
        expect.objectContaining({ userId: 'u2', state: 'pressed' }),
        expect.objectContaining({ userId: 'u3', state: 'excluded' }),
        expect.objectContaining({ userId: 'u4', state: 'excluded' }),
      ]),
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      'task.press_requested',
      expect.objectContaining({ participantIds: ['u1'] }),
      expect.anything(),
    );
  });

  it('активная стадия: существующий раунд той же кнопки продолжается', async () => {
    const { service, repo } = setup();
    const state = await service.ensureForStage({} as never, 't1');
    expect(state).toEqual({ transitionId: 'tr1', roundStarted: true, emptySources: false });
    expect(repo.createRound).not.toHaveBeenCalled();
  });

  it('пустые источники: кнопка настроена, раунда нет — статус для 409', async () => {
    const { service, repo, sources } = setup();
    repo.findOpenRound.mockResolvedValueOnce(null as never);
    sources.resolve.mockResolvedValueOnce([]);

    const state = await service.ensureForStage({} as never, 't1');

    expect(state).toEqual({ transitionId: 'tr1', roundStarted: false, emptySources: true });
    expect(repo.createRound).not.toHaveBeenCalled();
  });

  it('после кворума карточка читает последний завершённый раунд (read-only)', async () => {
    const { service, repo } = setup();
    repo.findOpenRound.mockResolvedValueOnce(null as never);

    const view = await service.viewForTask('t1', 'closed-stage', 'viewer');

    expect(view?.completed).toBe(true);
    expect(view?.canSubmit).toBe(false);
    expect(view?.canReturn).toBe(false);
    expect(view?.entries[0]?.result?.text).toBe('Готово');
  });

  it('ответ внешнему нажавшему: последний раунд его собственной отметки', async () => {
    const { service, repo } = setup();
    const view = await service.viewLatestForTask('t1', 'external');
    expect(view?.id).toBe('r1');
    expect(repo.findLatestRoundForUser).toHaveBeenCalledWith(undefined, 'task', 't1', 'external');
  });

  it('чужой открытый раунд следующей стадии не отдаётся (#434, security)', async () => {
    const { service, repo } = setup();
    const foreign = {
      ...ROUND,
      id: 'r2',
      entries: [{ ...ROUND.entries[0], userId: 'other' }],
    };
    repo.findOpenRound.mockResolvedValueOnce(foreign as never);
    repo.findLatestRoundForUser.mockResolvedValueOnce({ ...ROUND, completedAt: new Date() });

    const view = await service.viewLatestForTask('t1', 'u1');

    expect(view?.id).toBe('r1');
    expect(view?.entries.map((entry) => entry.userId)).toEqual(['u1']);
  });
});

describe('PressRoundsService: состав сбора следует за задачей (#965)', () => {
  const entryFixture = (userId: string, order: number, state = 'waiting') => ({
    ...ROUND.entries[0],
    id: `e-${userId}`,
    userId,
    order,
    state,
    pressedAt: state === 'pressed' ? new Date() : null,
    result:
      state === 'pressed'
        ? { text: 'Готово', messageIds: [], fileCount: 0, minutes: null, date: null }
        : null,
  });

  function rosterSetup(
    entries: ReturnType<typeof entryFixture>[],
    resolved: { userId: string; order: number }[],
  ) {
    const state = { entries: entries.map((entry) => ({ ...entry })) };
    const repo = {
      findOpenRound: vi.fn(async () => ({ ...ROUND, entries: state.entries })),
      findRoundById: vi.fn(async () => ({ ...ROUND, entries: state.entries })),
      updateEntry: vi.fn(async (_tx: unknown, id: string, patch: Record<string, unknown>) => {
        const entry = state.entries.find((item) => item.id === id);
        if (entry) Object.assign(entry, patch);
      }),
      addEntry: vi.fn(async (_tx: unknown, _id: string, userId: string, order: number) => {
        state.entries.push(entryFixture(userId, order));
      }),
      completeRound: vi.fn(async () => void 0),
    };
    const sources = { resolve: vi.fn(async () => resolved) };
    const tasks = {
      lock: vi.fn(async () => void 0),
      findWithParticipants: vi.fn(async () => TASK),
    };
    const pressEvents = { updated: vi.fn(), completionBlocked: vi.fn() };
    const records = { write: vi.fn() };
    const service = new PressRoundsService(
      repo as never,
      sources as never,
      tasks as never,
      { lockProject: vi.fn() } as never,
      { emit: vi.fn() } as never,
      pressEvents as never,
      { pressTransitionsForStage: vi.fn() } as never,
      { findRefs: vi.fn(async () => []) } as never,
      records as never,
    );
    return { service, repo, records, pressEvents };
  }

  it('выпавший из задачи снимается с причиной, результат остаётся', async () => {
    const { service, repo, records } = rosterSetup(
      [entryFixture('u1', 0, 'pressed')],
      [{ userId: 'u2', order: 0 }],
    );

    await service.syncRoster({} as never, 't1', 'Выбыл из задачи', 'assignee');

    expect(repo.updateEntry).toHaveBeenCalledWith({}, 'e-u1', {
      state: 'excluded',
      returnReason: 'Выбыл из задачи',
      timeEntryId: null,
    });
    // Результат отметки не стирается — вклад остаётся в таблице и CSV.
    expect(repo.updateEntry.mock.calls[0]?.[2]).not.toHaveProperty('result');
    expect(records.write).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ recordKind: 'exclude', participantId: 'u1' }),
    );
    expect(repo.addEntry).toHaveBeenCalledWith({}, 'r1', 'u2', 1);
  });

  it('состав не менялся — ничего не пишем', async () => {
    const { service, repo } = rosterSetup(
      [entryFixture('u1', 0, 'pressed')],
      [{ userId: 'u1', order: 0 }],
    );

    await service.syncRoster({} as never, 't1', 'Состав задачи изменён', 'assignee');

    expect(repo.updateEntry).not.toHaveBeenCalled();
    expect(repo.addEntry).not.toHaveBeenCalled();
  });

  it('вернувшийся в задачу снова в кворуме', async () => {
    const excluded = entryFixture('u1', 0);
    excluded.state = 'excluded';
    const { service, repo } = rosterSetup([excluded], [{ userId: 'u1', order: 0 }]);

    await service.syncRoster({} as never, 't1', 'Состав задачи изменён', 'assignee');

    expect(repo.updateEntry).toHaveBeenCalledWith({}, 'e-u1', {
      state: 'waiting',
      returnReason: null,
      result: null,
    });
  });

  it('кворум собрался снятием — раунд закрывается, переход не выполняется сам', async () => {
    const { service, repo, pressEvents } = rosterSetup(
      [entryFixture('u1', 0, 'pressed'), entryFixture('u2', 1, 'waiting')],
      [{ userId: 'u1', order: 0 }],
    );

    await service.syncRoster({} as never, 't1', 'Выбыл из задачи', 'assignee');

    expect(repo.updateEntry).toHaveBeenCalledWith(
      {},
      'e-u2',
      expect.objectContaining({
        state: 'excluded',
      }),
    );
    expect(repo.completeRound).toHaveBeenCalledWith({}, 'r1', expect.any(Date));
    expect(pressEvents.completionBlocked).toHaveBeenCalled();
    expect(pressEvents.updated).toHaveBeenCalled();
  });
});
