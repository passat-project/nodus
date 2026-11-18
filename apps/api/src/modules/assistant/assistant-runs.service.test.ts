import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { AssistantRunsService } from './assistant-runs.service.js';
import type { RunRow } from './assistant.repository.js';

/**
 * Прогоны ассистента (#893, #896): владение (чужой — 404), поток с
 * нормализованным Last-Event-ID, отмена живого/зависшего прогона и
 * зарезервированного продолжения пачки (#916). Сервис сессий —
 * `assistant-services.test.ts`.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-17T10:00:00.000Z');

const user: AuthUser = {
  id: USER_ID,
  email: 'ivanov@nodus.by',
  displayName: 'Иванов Иван',
  permissions: ['assistant.use'],
};

function runRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN_ID,
    sessionId: SESSION_ID,
    userId: USER_ID,
    status: 'running',
    continuationOfMessageId: null,
    providerId: null,
    modelId: 'm1',
    inputTokens: null,
    outputTokens: null,
    contextTokens: null,
    errorCode: null,
    errorMessage: null,
    startedAt: NOW,
    finishedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

/** Доменный 404: сущности нет или она чужая. */
async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: expect.stringContaining('NOT_FOUND') });
}

describe('AssistantRunsService (#893)', () => {
  function makeService(run: RunRow | null = runRow()) {
    const repo = {
      findRun: vi.fn(async () => run),
      updateRun: vi.fn(async () => undefined),
      cancelQueuedRun: vi.fn(async () => false),
      cancelQueuedRuns: vi.fn(async () => 0),
    };
    const bus = { stream: vi.fn(() => ({ pipe: vi.fn(() => 'stream') })) };
    const runner = { cancel: vi.fn(() => true) };
    const service = new AssistantRunsService(repo as never, bus as never, runner as never);
    return { service, repo, bus, runner };
  }

  it('get: прогон владельца, иначе 404', async () => {
    const { service } = makeService();
    expect((await service.get(user, RUN_ID)).id).toBe(RUN_ID);
    const missing = makeService(null);
    await expectNotFound(missing.service.get(user, RUN_ID));
  });

  it('stream: нормализует Last-Event-ID (NaN и отрицательный → 0)', async () => {
    const { service, bus } = makeService();
    await service.stream(user, RUN_ID, Number.NaN);
    expect(bus.stream).toHaveBeenCalledWith(RUN_ID, 0, { terminal: false });
    await service.stream(user, RUN_ID, -5);
    expect(bus.stream).toHaveBeenLastCalledWith(RUN_ID, 0, { terminal: false });
    await service.stream(user, RUN_ID, 42);
    expect(bus.stream).toHaveBeenLastCalledWith(RUN_ID, 42, { terminal: false });
  });

  it('stream: завершённый прогон отдаёт журнал как терминальный', async () => {
    const { service, bus } = makeService(runRow({ status: 'completed' }));
    await service.stream(user, RUN_ID, 0);
    expect(bus.stream).toHaveBeenCalledWith(RUN_ID, 0, { terminal: true });
  });

  it('stream: чужой прогон — 404 до открытия потока', async () => {
    const { service, bus } = makeService(null);
    await expectNotFound(service.stream(user, RUN_ID, 0));
    expect(bus.stream).not.toHaveBeenCalled();
  });

  it('cancel: завершённый прогон — 409 ASSISTANT_RUN_ALREADY_FINISHED', async () => {
    const { service, runner } = makeService(runRow({ status: 'failed' }));
    await expect(service.cancel(user, RUN_ID)).rejects.toMatchObject({
      code: expect.stringContaining('ALREADY_FINISHED'),
    });
    expect(runner.cancel).not.toHaveBeenCalled();
  });

  it('cancel: живой прогон останавливает раннер и перечитывает статус', async () => {
    const { service, repo, runner } = makeService();
    repo.findRun
      .mockResolvedValueOnce(runRow())
      .mockResolvedValueOnce(runRow({ status: 'cancelled' }));
    const result = await service.cancel(user, RUN_ID);
    expect(runner.cancel).toHaveBeenCalledWith(RUN_ID);
    expect(repo.updateRun).not.toHaveBeenCalled();
    // «Стоп» останавливает и отложенное продолжение пачки этой сессии.
    expect(repo.cancelQueuedRuns).toHaveBeenCalledWith(SESSION_ID);
    expect(result.status).toBe('cancelled');
  });

  it('cancel: зарезервированное продолжение закрывается без раннера', async () => {
    const { service, repo, runner } = makeService(runRow({ status: 'queued' }));
    repo.cancelQueuedRun.mockResolvedValueOnce(true);
    repo.findRun
      .mockResolvedValueOnce(runRow({ status: 'queued' }))
      .mockResolvedValueOnce(runRow({ status: 'cancelled' }));
    const result = await service.cancel(user, RUN_ID);
    expect(repo.cancelQueuedRun).toHaveBeenCalledWith(RUN_ID);
    expect(runner.cancel).not.toHaveBeenCalled();
    expect(repo.updateRun).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
  });

  it('cancel: прогона нет в памяти — закрывает запись в БД', async () => {
    const { service, repo, runner } = makeService();
    runner.cancel.mockReturnValueOnce(false);
    repo.findRun
      .mockResolvedValueOnce(runRow())
      .mockResolvedValueOnce(runRow({ status: 'cancelled' }));
    await service.cancel(user, RUN_ID);
    expect(repo.updateRun).toHaveBeenCalledWith(RUN_ID, {
      status: 'cancelled',
      finishedAt: expect.any(Date),
      errorCode: 'cancelled',
      errorMessage: 'Прогон остановлен сотрудником',
    });
  });

  it('cancel: перечитывание не удалось — отдаёт прежнюю строку', async () => {
    const { service, repo } = makeService();
    repo.findRun.mockResolvedValueOnce(runRow()).mockResolvedValueOnce(null);
    const result = await service.cancel(user, RUN_ID);
    expect(result.id).toBe(RUN_ID);
  });
});
