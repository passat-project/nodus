import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent, TaskStageChangedPayload } from '@nodus/contracts';

import { TaskTransitionBlockService } from './task-transition-block.service.js';

const TX = { tx: true };
const RECORD = '00000000-0000-4000-8000-0000000000aa';
const TASK = '00000000-0000-4000-8000-000000000001';

function event(
  overrides: Partial<TaskStageChangedPayload> = {},
): DomainEvent<TaskStageChangedPayload> {
  return {
    id: 'event-1',
    type: 'task.stage_changed',
    actorId: 'bob',
    payload: {
      taskId: TASK,
      number: 7,
      audience: [],
      fromStageId: '00000000-0000-4000-8000-000000000002',
      toStageId: '00000000-0000-4000-8000-000000000003',
      toStageName: 'Приостановлена',
      fromState: 'active',
      toState: 'paused',
      transitionId: '00000000-0000-4000-8000-000000000004',
      creatorId: 'alice',
      assigneeId: 'bob',
      cause: 'transition',
      recordId: RECORD,
      transitionName: 'Приостановить',
      fromStageName: 'В работе',
      comment: 'Ждём согласование',
      commentLabel: 'Причина приостановки',
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
    clientMessageId: 'task-transition:event-1',
    text: 'Ждём согласование',
    kind: 'task_transition',
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
  const service = new TaskTransitionBlockService(
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

describe('блок перехода в чате задачи (#380)', () => {
  it('одна запись на event.id: kind, payload, текст причины, событие message_sent', async () => {
    const { service, writes, eventBus, vault } = setup();
    await service.post(event());
    expect(writes.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        authorId: 'bob',
        kind: 'task_transition',
        text: 'Ждём согласование',
        clientMessageId: 'task-transition:event-1',
        payload: expect.objectContaining({
          kind: 'task_transition',
          taskId: TASK,
          recordId: RECORD,
          transitionName: 'Приостановить',
          fromStageName: 'В работе',
          toStageName: 'Приостановлена',
          commentLabel: 'Причина приостановки',
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

  it('пропуски: нет recordId, actorId = null, нет причины и итога, флаг выключен', async () => {
    const noRecord = setup();
    await noRecord.service.post(event({ recordId: undefined }));
    expect(noRecord.taskChat.sync).not.toHaveBeenCalled();

    const noActor = setup();
    const e = event();
    await noActor.service.post({ ...e, actorId: null });
    expect(noActor.taskChat.sync).not.toHaveBeenCalled();

    const empty = setup();
    await empty.service.post(event({ comment: undefined, result: undefined }));
    expect(empty.taskChat.sync).not.toHaveBeenCalled();

    const off = setup({ enabled: false });
    await off.service.post(event());
    expect(off.taskChat.sync).not.toHaveBeenCalled();
  });

  it('удалённая задача: sync вернул null — записи нет', async () => {
    const { service, taskChat, writes } = setup();
    taskChat.sync.mockResolvedValueOnce(null);
    await service.post(event());
    expect(writes.insertMessage).not.toHaveBeenCalled();
  });

  it('актор вне беседы задачи — блок не пишется, журнал остаётся (#741)', async () => {
    const { service, writes, eventBus, logger } = setup({ member: false });
    await service.post(event());
    expect(writes.insertMessage).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
