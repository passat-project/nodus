import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { AssistantBatchesController } from './assistant-batches.controller.js';
import type { AssistantBatchesService } from './assistant-batches.service.js';
import type { AssistantContinuationService } from './agent/continuation.service.js';

/**
 * Проводка маршрутов пачки (#916): контроллер передаёт сервисам аргументы в
 * порядке сигнатуры. Живой прогон 18.11 поймал перестановку `continue` —
 * в Prisma уезжал `Authorization` вместо messageId (500); тест держит порядок.
 */

const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const USER = { id: 'user-1', email: 'a@b.by', displayName: 'А', permissions: [] } as AuthUser;
const AUTH = 'Bearer employee-token';

function makeController() {
  const batches = {
    executeAll: vi.fn(async () => ({ actions: [], continuationRunId: 'run-2' })),
    cancelAll: vi.fn(async () => ({ actions: [], continuationRunId: null })),
  } as unknown as AssistantBatchesService;
  const continuation = {
    continueNow: vi.fn(async () => 'run-3'),
  } as unknown as AssistantContinuationService;
  return {
    controller: new AssistantBatchesController(batches, continuation),
    batches,
    continuation,
  };
}

describe('AssistantBatchesController (#916)', () => {
  it('execute-all/cancel-all: пользователь, id сообщения, fresh Authorization', async () => {
    const { controller, batches } = makeController();
    await controller.executeAll(USER, MESSAGE_ID, AUTH);
    await controller.cancelAll(USER, MESSAGE_ID, AUTH);
    expect(batches.executeAll).toHaveBeenCalledWith(USER, MESSAGE_ID, AUTH);
    expect(batches.cancelAll).toHaveBeenCalledWith(USER, MESSAGE_ID, AUTH);
  });

  it('continue: порядок (user, authorization, messageId) и ответ {runId}', async () => {
    const { controller, continuation } = makeController();
    await expect(controller.continue(USER, MESSAGE_ID, AUTH)).resolves.toEqual({ runId: 'run-3' });
    expect(continuation.continueNow).toHaveBeenCalledWith(USER, AUTH, MESSAGE_ID);
  });
});
