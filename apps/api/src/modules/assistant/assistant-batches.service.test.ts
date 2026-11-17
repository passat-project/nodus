import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { AssistantBatchesService } from './assistant-batches.service.js';
import type { ActionRow, ActionBatchRow } from './assistant.repository.js';

/**
 * «Выполнить все» / «Отменить все» (#916): решение применяется к каждой
 * нерешённой карточке теми же путями, что и одиночные; ошибка одной карточки
 * не останавливает пачку; продолжение запускается ровно один раз.
 */

const USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  displayName: 'Иванов Иван',
  permissions: [],
};
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const AUTH = 'Bearer token';
const NOW = new Date('2026-11-18T10:00:00.000Z');

function card(id: string, state: string): ActionRow {
  return {
    id,
    runId: 'run-1',
    messageId: MESSAGE_ID,
    userId: USER.id,
    toolId: 'tasks.create',
    title: 'Создать задачу',
    summary: 'Задача «Монтаж»',
    fields: [],
    consequences: 'Появится задача',
    undoable: true,
    automatic: false,
    state,
    args: {},
    resultData: null,
    resultPreview: null,
    href: null,
    hrefLabel: null,
    errorCode: null,
    executedAt: null,
    undoneAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function batch(): ActionBatchRow {
  return {
    id: 'batch-1',
    messageId: MESSAGE_ID,
    sessionId: SESSION_ID,
    runId: 'run-1',
    userId: USER.id,
    state: 'open',
    continuationRunId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function build(options: { cards?: ActionRow[]; executeError?: Error } = {}) {
  const repo = {
    findActionBatch: vi.fn(async () => batch()),
    findActionsByMessage: vi.fn(async () => options.cards ?? []),
  };
  const actions = {
    execute: vi.fn(async (_userId: string, id: string) => {
      if (options.executeError && id === 'a-1') throw options.executeError;
      return card(id, 'executed');
    }),
    cancel: vi.fn(async (_userId: string, id: string) => card(id, 'cancelled')),
  };
  const continuation = { afterDecision: vi.fn(async () => 'run-next') };
  const service = new AssistantBatchesService(
    repo as never,
    actions as never,
    continuation as never,
  );
  return { service, repo, actions, continuation };
}

describe('AssistantBatchesService (#916)', () => {
  it('executeAll: только proposed/failed, продолжение один раз', async () => {
    const { service, actions, continuation } = build({
      cards: [card('a-1', 'proposed'), card('a-2', 'executed'), card('a-3', 'failed')],
    });
    const result = await service.executeAll(USER, MESSAGE_ID, AUTH);
    expect(actions.execute).toHaveBeenCalledTimes(2);
    expect(actions.execute).toHaveBeenNthCalledWith(1, USER.id, 'a-1', AUTH);
    expect(actions.execute).toHaveBeenNthCalledWith(2, USER.id, 'a-3', AUTH);
    expect(continuation.afterDecision).toHaveBeenCalledTimes(1);
    expect(continuation.afterDecision).toHaveBeenCalledWith(USER, AUTH, MESSAGE_ID);
    expect(result.continuationRunId).toBe('run-next');
  });

  it('executeAll: ошибка одной карточки не останавливает пачку', async () => {
    const { service, actions, continuation } = build({
      cards: [card('a-1', 'proposed'), card('a-2', 'proposed')],
      executeError: new Error('CONFLICT'),
    });
    await expect(service.executeAll(USER, MESSAGE_ID, AUTH)).resolves.toBeTruthy();
    expect(actions.execute).toHaveBeenCalledTimes(2);
    expect(continuation.afterDecision).toHaveBeenCalledTimes(1);
  });

  it('cancelAll: отменяет нерешённые, продолжение один раз', async () => {
    const { service, actions, continuation } = build({
      cards: [card('a-1', 'proposed'), card('a-2', 'cancelled'), card('a-3', 'failed')],
    });
    await service.cancelAll(USER, MESSAGE_ID, AUTH);
    expect(actions.cancel).toHaveBeenCalledTimes(2);
    expect(actions.cancel).toHaveBeenNthCalledWith(1, USER.id, 'a-1');
    expect(actions.cancel).toHaveBeenNthCalledWith(2, USER.id, 'a-3');
    expect(continuation.afterDecision).toHaveBeenCalledTimes(1);
  });

  it('нет пачки — 404 (чужая/несуществующая не раскрывается)', async () => {
    const { service, repo } = build();
    repo.findActionBatch.mockResolvedValueOnce(null as never);
    await expect(service.executeAll(USER, MESSAGE_ID, AUTH)).rejects.toThrow();
  });
});
