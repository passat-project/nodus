import { describe, expect, it, vi } from 'vitest';

import { PressRoundsService } from './press-rounds.service.js';
import { ROUND, TASK } from './press-rounds.test-fixtures.js';

/** Состав сбора следует за задачей (#965): выбывший вне кворума с причиной,
 *  вернувшийся снова сдаёт, вклад выбывшего остаётся в журнале и CSV. */

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

describe('PressRoundsService: состав сбора следует за задачей (#965)', () => {
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
