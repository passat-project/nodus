import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent, TaskActionPressedPayload } from '@nodus/contracts';

import { TaskActionBlockService } from './task-action-block.service.js';

const TX = { tx: true };
const RECORD = '00000000-0000-4000-8000-0000000000aa';
const TASK = '00000000-0000-4000-8000-000000000001';

function event(
  overrides: Partial<TaskActionPressedPayload> = {},
): DomainEvent<TaskActionPressedPayload> {
  return {
    id: 'event-1',
    type: 'task.action_pressed',
    actorId: 'bob',
    payload: {
      taskId: TASK,
      number: 7,
      audience: [],
      actionId: '00000000-0000-4000-8000-000000000004',
      actionName: 'Запросить уточнение',
      stageName: 'В работе',
      recordId: RECORD,
      comment: 'Уточните марку бетона',
      commentLabel: 'Что уточнить',
      ...overrides,
    },
    createdAt: new Date().toISOString(),
  };
}

function setup(options: { enabled?: boolean; insert?: unknown; member?: boolean } = {}) {
  const row = {
    id: 'm1',
    conversationId: 'c1',
    seq: 5n,
    authorId: 'bob',
    clientMessageId: 'task-action:event-1',
    text: 'Уточните марку бетона',
    kind: 'task_action',
    payload: {},
    replyToId: null,
    replySnapshot: null,
    threadRootId: null,
    fwdConversationId: null,
    fwdMessageId: null,
    fwdAuthorId: null,
    fwdThreadRootId: null,
    editedAt: null,
    deletedAt: null,
    obliterated: false,
    urgent: false,
    mentionedUserIds: null,
    everMentionedUserIds: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const writes = {
    allocateSeqs: vi.fn(async () => 5n),
    insertMessage: vi.fn(async () => (options.insert === undefined ? row : options.insert)),
    touchLastMessageAt: vi.fn(async () => void 0),
  };
  const deps = {
    txRunner: { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) },
    taskChat: { sync: vi.fn(async (): Promise<string | null> => 'c1') },
    writes,
    mapper: { toFreshDto: vi.fn(async () => ({ id: 'm1' })) },
    conversations: {
      listMembers: vi.fn(async () => (options.member === false ? [] : [{ userId: 'bob' }])),
    },
    memberships: { revealHidden: vi.fn(async () => void 0) },
    vault: { applyMessageSent: vi.fn(async () => void 0) },
    eventBus: { emit: vi.fn(async () => void 0) },
    featureFlags: { isEnabled: vi.fn(async () => options.enabled ?? true) },
    logger: { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() },
  };
  const service = new TaskActionBlockService(
    deps.txRunner as never,
    deps.taskChat as never,
    deps.writes as never,
    deps.mapper as never,
    deps.conversations as never,
    deps.memberships as never,
    deps.vault as never,
    deps.eventBus as never,
    deps.featureFlags as never,
    deps.logger as never,
  );
  return { service, ...deps };
}

describe('блок действия в чате задачи (#633)', () => {
  it('одна запись на event.id: kind, payload, текст окна, событие message_sent', async () => {
    const { service, writes, eventBus, vault } = setup();
    await service.post(event());
    expect(writes.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        authorId: 'bob',
        kind: 'task_action',
        text: 'Уточните марку бетона',
        clientMessageId: 'task-action:event-1',
        payload: expect.objectContaining({
          kind: 'task_action',
          taskId: TASK,
          recordId: RECORD,
          actionName: 'Запросить уточнение',
          stageName: 'В работе',
          commentLabel: 'Что уточнить',
        }),
      }),
      TX,
    );
    expect(vault.applyMessageSent).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('повтор доставки (конфликт вставки) — без события и витрины', async () => {
    const { service, eventBus, vault } = setup({ insert: null });
    await service.post(event());
    expect(vault.applyMessageSent).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('актор вне беседы задачи — блок не пишется (чужая переписка)', async () => {
    const { service, writes, eventBus, logger } = setup({ member: false });
    await service.post(event());
    expect(writes.insertMessage).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('пропуски: флаг выключен, удалённая задача, событие без актора', async () => {
    const off = setup({ enabled: false });
    await off.service.post(event());
    expect(off.taskChat.sync).not.toHaveBeenCalled();

    const gone = setup();
    gone.taskChat.sync.mockResolvedValueOnce(null);
    await gone.service.post(event());
    expect(gone.writes.insertMessage).not.toHaveBeenCalled();

    const noActor = setup();
    await noActor.service.post({ ...event(), actorId: null });
    expect(noActor.taskChat.sync).not.toHaveBeenCalled();
  });
});
