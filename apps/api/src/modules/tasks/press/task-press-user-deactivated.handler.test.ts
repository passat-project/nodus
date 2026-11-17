import { describe, expect, it, vi } from 'vitest';

import { TaskPressUserDeactivatedHandler } from './task-press-user-deactivated.handler.js';

const TASK = { id: 't1', number: 7, title: 'Проверить раздел', assigneeId: 'boss' };

const entry = (userId: string, state: string, order: number) => ({
  id: `e-${userId}`,
  roundId: 'r1',
  userId,
  state,
  order,
});

function setup(entries: ReturnType<typeof entry>[]) {
  const round = {
    id: 'r1',
    entityKind: 'task',
    entityId: 't1',
    stageId: 's1',
    transitionId: 'tr1',
    transitionName: 'Завершить',
    config: { sources: [{ kind: 'coexecutors' }], quorum: { kind: 'all' } },
    completedAt: null,
    cancelledAt: null,
    entries,
  };
  const repo = {
    findOpenRoundsForUser: vi.fn(async () => [round]),
    findRoundById: vi.fn(async () => round),
    updateEntry: vi.fn(async () => undefined),
    completeRound: vi.fn(async () => undefined),
  };
  const tasks = {
    lock: vi.fn(async () => undefined),
    findWithParticipants: vi.fn(async () => TASK),
  };
  const records = { write: vi.fn(async () => undefined) };
  const engine = { execute: vi.fn(async () => ({ stage: {}, recordId: 'rec' })) };
  const pressEvents = { completionBlocked: vi.fn(async () => undefined) };
  const handler = new TaskPressUserDeactivatedHandler(
    {
      run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ $executeRawUnsafe: vi.fn() })),
    } as never,
    repo as never,
    tasks as never,
    pressEvents as never,
    records as never,
    engine as never,
  );
  return { handler, repo, engine, records, pressEvents };
}

describe('TaskPressUserDeactivatedHandler (#434, В3)', () => {
  it('снимает деактивированного с причиной; кворум не собран — перехода нет', async () => {
    const { handler, repo, engine, records } = setup([
      entry('u1', 'waiting', 0),
      entry('u2', 'waiting', 1),
    ]);
    await handler.handle({ payload: { userId: 'u1' } } as never);
    expect(repo.updateEntry).toHaveBeenCalledWith(
      expect.anything(),
      'e-u1',
      expect.objectContaining({ state: 'excluded', returnReason: 'Сотрудник деактивирован' }),
    );
    expect(records.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordKind: 'exclude', participantId: 'u1' }),
    );
    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('после снятия кворум собран — переход выполняется один раз', async () => {
    const { handler, repo, engine } = setup([entry('u1', 'waiting', 0), entry('u2', 'pressed', 1)]);
    await handler.handle({ payload: { userId: 'u1' } } as never);
    expect(repo.completeRound).toHaveBeenCalledTimes(1);
    expect(engine.execute).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      'task',
      expect.objectContaining({ id: 'boss' }),
      { transitionId: 'tr1' },
      expect.objectContaining({ pressCompletion: true }),
    );
  });
});
