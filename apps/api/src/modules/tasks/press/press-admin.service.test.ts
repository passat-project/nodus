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
  const engine = { execute: vi.fn(async () => ({ stage: {}, recordId: 'rec' })) };
  const service = new PressAdminService(
    { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } as never,
    repo as never,
    rounds as never,
    tasks as never,
    records as never,
    pressEvents as never,
    engine as never,
  );
  return { service, repo, rounds, tasks, records, pressEvents, engine, round };
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

  it('снятие: excluded + причина + журнал', async () => {
    const { service, repo, records, round } = setup('waiting');
    repo.findOpenRound.mockResolvedValue({
      ...round,
      entries: [entry('waiting', 'e1', 'u1', 0), entry('waiting', 'e2', 'u2', 1)],
    });
    const view = await service.excludeEntries({ id: 'assignee', permissions: [] } as never, 't1', {
      userIds: ['u2'],
      reason: 'Уволен',
    });
    expect(view).not.toBeNull();
    expect(repo.updateEntry).toHaveBeenCalledWith(
      expect.anything(),
      'e2',
      expect.objectContaining({ state: 'excluded', returnReason: 'Уволен' }),
    );
    expect(records.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordKind: 'exclude', participantId: 'u2' }),
    );
  });

  it('снятие последнего активного участника запрещено', async () => {
    const { service, round } = setup('waiting');
    await expect(
      service.excludeEntries({ id: 'assignee', permissions: [] } as never, 't1', {
        userIds: ['u1'],
        reason: 'Причина',
      }),
    ).rejects.toThrow();
    expect(round.entries[0]?.state).toBe('waiting');
  });

  it('снятие ждущего при собранном кворуме выполняет переход', async () => {
    const { service, repo, engine, round } = setup('waiting');
    repo.findOpenRound.mockResolvedValue({
      ...round,
      entries: [entry('pressed', 'e1', 'assignee', 0), entry('waiting', 'e2', 'u1', 1)],
    });
    const view = await service.excludeEntries({ id: 'assignee', permissions: [] } as never, 't1', {
      userIds: ['u1'],
      reason: 'Уволен',
    });
    expect(view).toBeNull();
    expect(repo.completeRound).toHaveBeenCalled();
    expect(engine.execute).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      'task',
      expect.objectContaining({ id: 'assignee' }),
      { transitionId: 'tr1' },
      { pressCompletion: true },
    );
  });

  it('кворум снятием: итогом становится последняя сданная отметка (решение 3A)', async () => {
    const { service, repo, engine, round } = setup('waiting');
    const pressed = (id: string, userId: string, order: number, text: string, day: number) => ({
      ...entry('pressed', id, userId, order),
      pressedAt: new Date(`2026-01-0${day}T10:00:00.000Z`),
      result: { text, messageIds: [], fileCount: 0, minutes: null, date: null },
      input: { result: { text, messageIds: [] }, comment: `Комментарий ${text}` },
    });
    repo.findOpenRound.mockResolvedValue({
      ...round,
      entries: [
        pressed('e1', 'assignee', 0, 'Первый', 1),
        pressed('e2', 'u2', 1, 'Второй', 2),
        entry('waiting', 'e3', 'u3', 2),
      ],
    } as never);

    await service.excludeEntries({ id: 'assignee', permissions: [] } as never, 't1', {
      userIds: ['u3'],
      reason: 'Выбыл',
    });

    expect(engine.execute).toHaveBeenLastCalledWith(
      expect.anything(),
      't1',
      'task',
      expect.anything(),
      { transitionId: 'tr1' },
      {
        pressCompletion: true,
        form: {
          result: { text: 'Второй', messageIds: [] },
          comment: 'Комментарий Второй',
        },
      },
    );
  });
});
