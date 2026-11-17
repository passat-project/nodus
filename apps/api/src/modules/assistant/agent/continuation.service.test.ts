import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { AssistantContinuationService } from './continuation.service.js';
import type { ActionBatchRow } from '../assistant.repository.js';

/**
 * Продолжение после карточек (#916): старт ровно одного прогона и только
 * когда решены ВСЕ карточки пачки; частичное решение не двигает чат;
 * «Продолжить сейчас» закрывает пачку и упоминает ожидающие.
 */

const USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  displayName: 'Иванов Иван',
  permissions: [],
};

const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

function batch(overrides: Partial<ActionBatchRow> = {}): ActionBatchRow {
  return {
    id: 'batch-1',
    messageId: MESSAGE_ID,
    sessionId: '33333333-3333-4333-8333-333333333333',
    runId: '44444444-4444-4444-8444-444444444444',
    userId: USER.id,
    state: 'open',
    continuationRunId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function build(options: { batch?: ActionBatchRow | null; pending?: number } = {}) {
  const repo = {
    findActionBatch: vi.fn(async () => (options.batch === undefined ? batch() : options.batch)),
    countActionsByMessage: vi.fn(async () => ({ total: 3, pending: options.pending ?? 0 })),
    createRun: vi.fn(async () => undefined),
    claimBatchContinuation: vi.fn(async () => true),
    deleteRun: vi.fn(async () => undefined),
    claimBatchContinueNow: vi.fn(async () => batch({ state: 'closed' })),
  };
  const runner = { isActive: vi.fn(() => false), start: vi.fn() };
  const flags = { enabledModules: vi.fn(async () => ['tasks']) };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new AssistantContinuationService(
    repo as never,
    runner as never,
    flags as never,
    logger as never,
  );
  return { service, repo, runner };
}

describe('AssistantContinuationService: автопродолжение (#916)', () => {
  it('все карточки решены — один прогон с continuation-параметрами', async () => {
    const { service, repo, runner } = build();
    const runId = await service.afterDecision(USER, 'Bearer token', MESSAGE_ID);
    expect(runId).toBeTruthy();
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ continuationOfMessageId: MESSAGE_ID, autoExecute: false }),
    );
    expect(repo.claimBatchContinuation).toHaveBeenCalledWith(MESSAGE_ID, runId);
    expect(runner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        authorization: 'Bearer token',
        autoExecute: false,
        continuation: { ofMessageId: MESSAGE_ID, pendingCards: 0 },
      }),
    );
  });

  it('есть нерешённые карточки — продолжения нет', async () => {
    const { service, runner } = build({ pending: 2 });
    expect(await service.afterDecision(USER, 'Bearer token', MESSAGE_ID)).toBeNull();
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('пачка закрыта/продолжена или её нет — no-op', async () => {
    for (const value of [null, batch({ state: 'closed' }), batch({ state: 'continued' })]) {
      const { service, runner } = build({ batch: value });
      expect(await service.afterDecision(USER, 'Bearer token', MESSAGE_ID)).toBeNull();
      expect(runner.start).not.toHaveBeenCalled();
    }
    const { service } = build();
    expect(await service.afterDecision(USER, 'Bearer token', null)).toBeNull();
  });

  it('гонка решений: пачку продолжил другой запрос — прогон удаляется', async () => {
    const { service, repo, runner } = build();
    repo.claimBatchContinuation.mockResolvedValueOnce(false);
    expect(await service.afterDecision(USER, 'Bearer token', MESSAGE_ID)).toBeNull();
    expect(repo.deleteRun).toHaveBeenCalled();
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('исходный прогон ещё печатает — автопродолжение не стартует', async () => {
    const { service, runner } = build();
    runner.isActive.mockReturnValueOnce(true);
    expect(await service.afterDecision(USER, 'Bearer token', MESSAGE_ID)).toBeNull();
    expect(runner.start).not.toHaveBeenCalled();
  });
});

describe('AssistantContinuationService: «Продолжить сейчас» (#916)', () => {
  it('открытая пачка закрывается и агент продолжает с ожидающими карточками', async () => {
    const { service, repo, runner } = build({ pending: 1 });
    const runId = await service.continueNow(USER, 'Bearer token', MESSAGE_ID);
    expect(repo.claimBatchContinueNow).toHaveBeenCalledWith(MESSAGE_ID);
    expect(runner.start).toHaveBeenCalledWith(
      expect.objectContaining({ continuation: { ofMessageId: MESSAGE_ID, pendingCards: 1 } }),
    );
    expect(runId).toBeTruthy();
  });

  it('повторный клик после автопродолжения возвращает тот же прогон', async () => {
    const { service, runner } = build({
      batch: batch({ state: 'continued', continuationRunId: 'run-existing' }),
    });
    expect(await service.continueNow(USER, 'Bearer token', MESSAGE_ID)).toBe('run-existing');
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('закрытая пачка — конфликт; идущий ответ — конфликт', async () => {
    const closed = build({ batch: batch({ state: 'closed' }) });
    await expect(closed.service.continueNow(USER, 'Bearer token', MESSAGE_ID)).rejects.toThrow();

    const active = build();
    active.runner.isActive.mockReturnValue(true);
    await expect(active.service.continueNow(USER, 'Bearer token', MESSAGE_ID)).rejects.toThrow();
    expect(active.runner.start).not.toHaveBeenCalled();
  });

  it('пачки нет — 404', async () => {
    const { service } = build({ batch: null });
    await expect(service.continueNow(USER, 'Bearer token', MESSAGE_ID)).rejects.toThrow();
  });
});
