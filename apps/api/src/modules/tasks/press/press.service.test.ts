import { describe, expect, it, vi } from 'vitest';

import { PressService } from './press.service.js';

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
    updateEntry: vi.fn(async (_tx, id, data) => ({ id, ...data })),
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
  const pressEvents = {
    isBroadcast: (config: { sources?: { kind: string }[] }) =>
      config.sources?.some((source) => source.kind === 'all_employees') ?? false,
    updated: vi.fn(async () => void 0),
    submitted: vi.fn(async () => void 0),
    returned: vi.fn(async () => void 0),
  };
  const messages = {
    taskMessages: vi.fn(async (_taskId: string, ids: string[]) =>
      ids.map((id) => ({ messageId: id, attachmentCount: 0 })),
    ),
  };
  const records = { write: vi.fn(async () => void 0) };
  const engine = { execute: vi.fn(async () => ({ stage: {}, recordId: 'rec' })) };
  const reader = { checkPressInput: vi.fn(() => ({ missing: [], unexpected: [] })) };
  const service = new PressService(
    { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } as never,
    repo as never,
    rounds as never,
    tasks as never,
    time as never,
    messages as never,
    records as never,
    pressEvents as never,
    engine as never,
    reader as never,
  );
  return { service, repo, rounds, tasks, time, messages, records, pressEvents, engine, reader, round };
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

  it('сдача: вложения сообщений проверяются и считаются по факту (#434)', async () => {
    const { service, repo, messages, records } = setup();
    messages.taskMessages.mockResolvedValueOnce([
      { messageId: 'm1', attachmentCount: 2 },
      { messageId: 'm2', attachmentCount: 1 },
    ]);
    await service.submit({ id: 'u1', permissions: [] } as never, 't1', {
      result: { text: 'Итог', messageIds: ['m1', 'm2'] },
    });
    expect(repo.updateEntry).toHaveBeenCalledWith(
      expect.anything(),
      'e1',
      expect.objectContaining({
        result: expect.objectContaining({ fileCount: 3 }),
      }),
    );
    expect(records.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordKind: 'press', participantId: 'u1' }),
    );
  });

  it('сдача: чужое/удалённое сообщение — 404 без записи отметки', async () => {
    const { service, repo, messages } = setup();
    messages.taskMessages.mockResolvedValueOnce([]);
    await expect(
      service.submit({ id: 'u1', permissions: [] } as never, 't1', {
        result: { text: 'Итог', messageIds: ['alien'] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repo.updateEntry).not.toHaveBeenCalled();
  });

  it('сдача отметки пишет событие блока чата для адресного раунда', async () => {
    const { service, pressEvents } = setup();
    await service.submit({ id: 'u1', permissions: [] } as never, 't1', {});
    expect(pressEvents.submitted).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'u1',
      'Ознакомлен',
      expect.anything(),
      1,
      1,
    );
  });

  it('«Все сотрудники» — без событий блоков чата (анти-спам)', async () => {
    const { service, pressEvents, repo, round } = setup(undefined, {
      quorum: { kind: 'all' },
      order: 'parallel',
    });
    repo.findOpenRound.mockResolvedValue({
      ...round,
      config: { ...round.config, sources: [{ kind: 'all_employees' }] },
    });
    await service.submit({ id: 'u1', permissions: [] } as never, 't1', {});
    expect(pressEvents.submitted).not.toHaveBeenCalled();
  });
});
