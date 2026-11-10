import { describe, expect, it, vi } from 'vitest';
import type {
  DomainEvent,
  TaskPressReturnedPayload,
  TaskPressSubmittedPayload,
} from '@nodus/contracts';

import { TaskPressBlockService } from './task-press-block.service.js';
import {
  TaskPressReturnedBlockHandler,
  TaskPressSubmittedBlockHandler,
} from './task-press-block.handler.js';

const TX = { tx: true };
const TASK = '00000000-0000-4000-8000-000000000001';

function submitted(
  overrides: Partial<TaskPressSubmittedPayload> = {},
): DomainEvent<TaskPressSubmittedPayload> {
  return {
    id: 'press-event-1',
    type: 'task.press_submitted',
    actorId: 'bob',
    payload: {
      taskId: TASK,
      number: 7,
      audience: [],
      title: 'Сдать отчёт',
      transitionName: 'Завершить',
      broadcast: false,
      result: { text: 'Раздел ОВ1 согласован', fileCount: 2, minutes: 30 },
      pressed: 1,
      total: 2,
      ...overrides,
    },
    createdAt: new Date().toISOString(),
  };
}

function returned(
  overrides: Partial<TaskPressReturnedPayload> = {},
): DomainEvent<TaskPressReturnedPayload> {
  return {
    id: 'press-event-2',
    type: 'task.press_returned',
    actorId: 'alice',
    payload: {
      taskId: TASK,
      number: 7,
      audience: [],
      title: 'Сдать отчёт',
      transitionName: 'Завершить',
      broadcast: false,
      userIds: ['bob', 'carol'],
      reason: 'Уточнить раздел',
      ...overrides,
    },
    createdAt: new Date().toISOString(),
  };
}

function setup(options: { enabled?: boolean; insert?: unknown } = {}) {
  const row = {
    id: 'm1',
    conversationId: 'c1',
    seq: 5n,
    authorId: 'bob',
    clientMessageId: 'task-press:press-event-1',
    text: '',
    kind: 'task_press',
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
    conversations: { listMembers: vi.fn(async () => []) },
    memberships: { revealHidden: vi.fn(async () => void 0) },
    vault: { applyMessageSent: vi.fn(async () => void 0) },
    eventBus: { emit: vi.fn(async () => void 0) },
    featureFlags: { isEnabled: vi.fn(async () => options.enabled ?? true) },
    logger: { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() },
  };
  const service = new TaskPressBlockService(
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

describe('блок отметки сбора в чате задачи (#434)', () => {
  it('сдача: kind task_press, текст результата, файлы, событие message_sent', async () => {
    const { service, writes, eventBus, vault } = setup();
    await service.post(submitted());
    expect(writes.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        authorId: 'bob',
        kind: 'task_press',
        text: 'Раздел ОВ1 согласован',
        clientMessageId: 'task-press:press-event-1',
        payload: expect.objectContaining({
          kind: 'task_press',
          taskId: TASK,
          transitionName: 'Завершить',
          state: 'pressed',
          fileCount: 2,
          returnCount: null,
        }),
      }),
      TX,
    );
    expect(vault.applyMessageSent).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('возврат: причина текстом и число возвращённых', async () => {
    const { service, writes } = setup();
    await service.post(returned());
    expect(writes.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'task_press',
        text: 'Уточнить раздел',
        payload: expect.objectContaining({ state: 'returned', returnCount: 2 }),
      }),
      TX,
    );
  });

  it('«Все сотрудники» (broadcast) — блок не пишется (анти-спам)', async () => {
    const { service, taskChat, writes } = setup();
    await service.post(submitted({ broadcast: true }));
    await service.post(returned({ broadcast: true }));
    expect(taskChat.sync).not.toHaveBeenCalled();
    expect(writes.insertMessage).not.toHaveBeenCalled();
  });

  it('повтор доставки и выключенный флаг чата — без побочных записей', async () => {
    const duplicate = setup({ insert: null });
    await duplicate.service.post(submitted());
    expect(duplicate.vault.applyMessageSent).not.toHaveBeenCalled();
    expect(duplicate.eventBus.emit).not.toHaveBeenCalled();

    const off = setup({ enabled: false });
    await off.service.post(submitted());
    expect(off.taskChat.sync).not.toHaveBeenCalled();
  });

  it('слушатели делегируют сдачу и возврат сервису блоков', async () => {
    const blocks = { post: vi.fn(async () => void 0) };
    await new TaskPressSubmittedBlockHandler(blocks as never).handle(submitted());
    await new TaskPressReturnedBlockHandler(blocks as never).handle(returned());
    expect(blocks.post).toHaveBeenCalledTimes(2);
    expect(TaskPressSubmittedBlockHandler.eventType).toBe('task.press_submitted');
    expect(TaskPressReturnedBlockHandler.eventType).toBe('task.press_returned');
  });
});
