import { describe, expect, it, vi } from 'vitest';

import { PressService } from './press.service.js';

const TASK = {
  id: 't1',
  number: 17,
  projectId: null,
  stageId: 's1',
  creatorId: 'creator',
  assigneeId: 'assignee',
  participants: [],
};

const entry = (state: string, timeEntryId: string | null = null) => ({
  id: 'e1',
  roundId: 'r1',
  userId: 'u1',
  order: 0,
  state,
  pressedAt: null,
  input: null,
  result: null,
  timeEntryId,
  returnReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function setup(state = 'waiting', config = { quorum: { kind: 'all' }, order: 'parallel' }) {
  const round = {
    id: 'r1',
    entityKind: 'task',
    entityId: 't1',
    stageId: 's1',
    transitionId: 'tr1',
    transitionName: 'Ознакомлен',
    cycle: 1,
    config: { sources: [{ kind: 'coexecutors' }], excludeAuthor: true, ...config },
    form: {
      enabled: true,
      sections: [
        { kind: 'time', mode: 'if_empty' },
        { kind: 'result' },
        { kind: 'comment', label: 'Комментарий', required: false },
      ],
    },
    startedAt: new Date(),
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    entries: [entry(state)],
  };
  const repo = {
    findOpenRound: vi.fn(async () => round),
    updateEntry: vi.fn(async (_tx, id, data) => {
      const target = round.entries.find((item) => item.id === id)!;
      Object.assign(target, data);
      return target;
    }),
    completeRound: vi.fn(async () => ({ ...round, completedAt: new Date() })),
  };
  const view = { id: 'r1', pressed: 1, total: 1 } as never;
  const rounds = { viewForTask: vi.fn(async () => view) };
  const tasks = {
    lock: vi.fn(async () => void 0),
    findWithParticipants: vi.fn(async () => TASK),
  };
  const time = {
    addManualInTx: vi.fn(async () => ({ id: 'time1' })),
    removeInTx: vi.fn(async () => void 0),
  };
  const events = { emit: vi.fn(async () => void 0) };
  const engine = { execute: vi.fn(async () => ({ stage: {}, recordId: 'rec' })) };
  const reader = { checkPressInput: vi.fn(() => ({ missing: [], unexpected: [] })) };
  const service = new PressService(
    { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } as never,
    repo as never,
    rounds as never,
    tasks as never,
    time as never,
    events as never,
    engine as never,
    reader as never,
  );
  return { service, repo, rounds, tasks, time, events, engine, reader, round };
}

describe('PressService (#434)', () => {
  it('сдача отметки без кворума пишет время и возвращает прогресс', async () => {
    const { service, time, repo, engine, round } = setup();
    repo.findOpenRound.mockResolvedValue({
      ...round,
      entries: [entry('waiting'), { ...entry('waiting'), id: 'e2', userId: 'u2', order: 1 }],
    });
    const result = await service.submit(
      { id: 'u1', permissions: [] } as never,
      't1',
      { time: { minutes: 30, date: '2026-11-09' } },
    );
    expect(time.addManualInTx).toHaveBeenCalledTimes(1);
    expect(repo.updateEntry).toHaveBeenCalledWith(
      expect.anything(),
      'e1',
      expect.objectContaining({ state: 'pressed', timeEntryId: 'time1' }),
    );
    expect(engine.execute).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
  });

  it('последняя отметка выполняет переход с pressCompletion и без повторного времени', async () => {
    const { service, engine, repo } = setup(undefined, { quorum: { kind: 'all' }, order: 'parallel' });
    const result = await service.submit({ id: 'u1', permissions: [] } as never, 't1', {});
    expect(repo.completeRound).toHaveBeenCalledTimes(1);
    expect(engine.execute).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      'task',
      expect.objectContaining({ id: 'u1' }),
      { transitionId: 'tr1' },
      expect.objectContaining({ pressCompletion: true }),
    );
    expect(result).toBeNull();
  });

  it('отзыв нажатой отметки удаляет запись времени', async () => {
    const { service, time, repo } = setup('pressed');
    repo.findOpenRound.mockResolvedValue({
      ...(await repo.findOpenRound()),
      entries: [entry('pressed', 'time1')],
    });
    await service.withdraw({ id: 'u1', permissions: [] } as never, 't1');
    expect(time.removeInTx).toHaveBeenCalledWith(expect.anything(), 'u1', 'time1');
    expect(repo.updateEntry).toHaveBeenCalledWith(
      expect.anything(),
      'e1',
      expect.objectContaining({ state: 'waiting', input: null, timeEntryId: null }),
    );
  });

  it('не участник раунда получает запрет', async () => {
    const { service, repo } = setup();
    repo.findOpenRound.mockResolvedValue({
      ...(await repo.findOpenRound()),
      entries: [entry('waiting')],
    });
    await expect(
      service.submit({ id: 'other', permissions: [] } as never, 't1', {}),
    ).rejects.toThrow();
  });
});
