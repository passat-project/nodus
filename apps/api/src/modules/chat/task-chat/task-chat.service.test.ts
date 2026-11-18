import { describe, expect, it, vi } from 'vitest';
import { CHAT_EVENTS } from '@nodus/contracts';

import type { TaskChatReader, TaskChatRoster } from '../../tasks/ports/task-chat-reader.port.js';
import type { TaskChatRepository } from './task-chat.repository.js';
import { TaskChatService } from './task-chat.service.js';

const TX = { tx: true };
const TASK = 'task-1';
const CONV = 'conv-1';

function setup(opts: {
  roster: TaskChatRoster | null;
  /** Состав, прочитанный ПОСЛЕ блокировки (гонка), если отличается. */
  rosterAfterLock?: TaskChatRoster | null;
  existing?: boolean;
  current?: string[];
  canView?: boolean;
}) {
  const repo = {
    find: vi.fn().mockResolvedValue(opts.existing === false ? null : CONV),
    findOrCreate: vi.fn().mockResolvedValue({ id: CONV, created: true }),
    lock: vi.fn(),
    members: vi.fn().mockResolvedValue(opts.current ?? []),
    addMembers: vi.fn(async (_tx, _id, rows: { userId: string }[]) => rows.map((r) => r.userId)),
    removeMembers: vi.fn(),
  };
  const eventBus = { emit: vi.fn() };
  const order: string[] = [];
  const roster = vi.fn(async () => {
    order.push('roster');
    return opts.roster;
  });
  if (opts.rosterAfterLock !== undefined) {
    const afterLock = opts.rosterAfterLock;
    repo.lock.mockImplementation(async () => {
      roster.mockResolvedValue(afterLock);
    });
  }
  const reader: TaskChatReader = {
    roster,
    refs: vi.fn(),
    canView: vi.fn().mockResolvedValue(opts.canView ?? true),
    isDecider: vi.fn().mockResolvedValue(false),
    deciderTaskIds: vi.fn().mockResolvedValue([]),
  };
  const txRunner = {
    run: (fn: (tx: unknown) => unknown) => {
      order.push('tx');
      return fn(TX);
    },
  };
  const service = new TaskChatService(
    repo as unknown as TaskChatRepository,
    txRunner as never,
    eventBus as never,
    reader,
  );
  return { service, repo, eventBus, order };
}

const roster: TaskChatRoster = {
  creatorId: 'alice',
  members: [
    { userId: 'alice', muted: false },
    { userId: 'bob', muted: false },
    { userId: 'carol', muted: true },
  ],
};

describe('TaskChatService.sync (#252)', () => {
  it('новая беседа: постановщик — owner, наблюдатель без звука, conversation_created', async () => {
    const { service, repo, eventBus } = setup({ roster, existing: false });
    await expect(service.sync(TASK, 'alice')).resolves.toBe(CONV);
    expect(repo.findOrCreate).toHaveBeenCalledWith(TX, TASK, 'alice');
    expect(repo.addMembers).toHaveBeenCalledWith(TX, CONV, [
      { userId: 'alice', role: 'owner', muted: false },
      { userId: 'bob', role: 'member', muted: false },
      { userId: 'carol', role: 'member', muted: true },
    ]);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.CONVERSATION_CREATED,
      expect.objectContaining({
        conversationId: CONV,
        type: 'task',
        memberIds: ['alice', 'bob', 'carol'],
      }),
      expect.anything(),
    );
  });

  it('существующая: добавляет новых, убирает выбывших, состав совпал — без событий', async () => {
    const { service, repo, eventBus } = setup({ roster, current: ['alice', 'bob', 'dave'] });
    await service.sync(TASK, 'alice');
    expect(repo.findOrCreate).not.toHaveBeenCalled();
    expect(repo.addMembers).toHaveBeenCalledWith(TX, CONV, [
      { userId: 'carol', role: 'member', muted: true },
    ]);
    expect(repo.removeMembers).toHaveBeenCalledWith(TX, CONV, ['dave']);
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MEMBER_ADDED,
      { conversationId: CONV, userIds: ['carol'], role: 'member' },
      expect.anything(),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      CHAT_EVENTS.MEMBER_REMOVED,
      { conversationId: CONV, userId: 'dave', actorId: 'alice' },
      expect.anything(),
    );

    const same = setup({ roster, current: ['alice', 'bob', 'carol'] });
    await same.service.sync(TASK, 'alice');
    expect(same.eventBus.emit).not.toHaveBeenCalled();
  });

  it('гонка: состав применяется тот, что прочитан после блокировки', async () => {
    const withoutCarol = { ...roster, members: roster.members.slice(0, 2) };
    const { service, repo } = setup({
      roster,
      rosterAfterLock: withoutCarol,
      current: ['alice', 'bob', 'carol'],
    });
    await service.sync(TASK, 'alice');
    expect(repo.removeMembers).toHaveBeenCalledWith(TX, CONV, ['carol']);
  });

  it('задача удалена — состав беседы распускается, новая не создаётся', async () => {
    const { service, repo, eventBus } = setup({ roster: null, current: ['alice', 'bob'] });
    await expect(service.sync(TASK, 'alice')).resolves.toBeNull();
    expect(repo.findOrCreate).not.toHaveBeenCalled();
    expect(repo.removeMembers).toHaveBeenCalledWith(TX, CONV, ['alice', 'bob']);
    expect(eventBus.emit).toHaveBeenCalledTimes(2);

    const none = setup({ roster: null, existing: false });
    await expect(none.service.sync(TASK, null)).resolves.toBeNull();
    expect(none.repo.findOrCreate).not.toHaveBeenCalled();
  });

  it('состав читается ДО открытия транзакции (AUD-022), под локом — только гейт #252', async () => {
    const { service, order } = setup({ roster, current: ['alice', 'bob', 'carol'] });
    await service.sync(TASK, 'alice');
    const txIndex = order.indexOf('tx');
    // Первое чтение — вне транзакции: порт без tx не занимает второе соединение.
    expect(order.slice(0, txIndex)).toEqual(['roster']);
    // Повторное чтение под блокировкой осталось (порт не принимает tx) —
    // известное исключение AUD-022.
    expect(order.slice(txIndex)).toEqual(['tx', 'roster']);
  });
});

describe('TaskChatService.openForUser (#252)', () => {
  it('невидимая задача — 404 без записи', async () => {
    const { service, repo } = setup({ roster, canView: false });
    await expect(service.openForUser(TASK, { id: 'eve', permissions: [] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('видит задачу, но не участник (руководитель/view_all) — тот же 404 без записи', async () => {
    const { service, repo } = setup({ roster });
    await expect(service.openForUser(TASK, { id: 'boss', permissions: [] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Task not found',
    });
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('участник — беседа задачи', async () => {
    const { service } = setup({ roster, current: ['alice', 'bob', 'carol'] });
    await expect(service.openForUser(TASK, { id: 'carol', permissions: [] })).resolves.toBe(CONV);
  });
});
