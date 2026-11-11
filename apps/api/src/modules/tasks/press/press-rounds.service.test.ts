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
  const service = new PressRoundsService(
    repo as never,
    sources as never,
    tasks as never,
    events as never,
    pressReader as never,
    users as never,
  );
  return { service, repo, sources, tasks, pressReader };
}

describe('PressRoundsService (#434)', () => {
  it('пауза сохраняет открытый раунд: не отменяет и не создаёт новый', async () => {
    const { service, repo, tasks } = setup();
    tasks.findWithParticipants.mockResolvedValueOnce({ ...TASK, systemState: 'paused' });

    const state = await service.ensureForStage({} as never, 't1');

    expect(state).toEqual({ transitionId: null, roundStarted: true, emptySources: false });
    expect(repo.cancelOpenRound).not.toHaveBeenCalled();
    expect(repo.createRound).not.toHaveBeenCalled();
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

  it('ответ внешнему нажавшему: последний раунд без видимости задачи', async () => {
    const { service } = setup();
    const view = await service.viewLatestForTask('t1', 'external');
    expect(view?.id).toBe('r1');
  });
});
