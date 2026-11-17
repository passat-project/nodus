import { describe, expect, it, vi } from 'vitest';
import type { AssistantAction, AuthUser } from '@nodus/contracts';

import { AssistantActionsController } from './assistant-actions.controller.js';

/**
 * Проводка решений по карточке (#899, #916): контроллер передаёт id
 * сотрудника (не объект), fresh `Authorization` и запускает продолжение
 * пачки по `messageId` карточки. Ошибка порядка аргументов здесь уже
 * стоила 500 в живом прогоне — тест держит контракт.
 */

const USER = { id: 'user-1', email: 'a@b.by', displayName: 'А', permissions: [] } as AuthUser;
const ACTION_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const AUTH = 'Bearer employee-token';

function card(overrides: Partial<AssistantAction> = {}): AssistantAction {
  return {
    id: ACTION_ID,
    messageId: MESSAGE_ID,
    toolId: 'tasks.create',
    title: 'Создать задачу',
    summary: 'Задача «Монтаж»',
    fields: [],
    consequences: 'Появится задача',
    undoable: true,
    automatic: false,
    state: 'executed',
    resultPreview: null,
    href: null,
    hrefLabel: null,
    errorCode: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    executedAt: null,
    undoneAt: null,
    ...overrides,
  };
}

function makeController() {
  const actions = {
    execute: vi.fn(async () => card()),
    cancel: vi.fn(async () => card({ state: 'cancelled' })),
    undo: vi.fn(async () => card({ state: 'undone' })),
  };
  const continuation = { afterDecision: vi.fn(async () => 'run-next') };
  return {
    controller: new AssistantActionsController(actions as never, continuation as never),
    actions,
    continuation,
  };
}

describe('AssistantActionsController (#899, #916)', () => {
  it('execute: карточка от имени сотрудника + продолжение по её messageId', async () => {
    const { controller, actions, continuation } = makeController();
    const result = await controller.execute(USER, ACTION_ID, AUTH);
    expect(actions.execute).toHaveBeenCalledWith(USER.id, ACTION_ID, AUTH);
    expect(continuation.afterDecision).toHaveBeenCalledWith(USER, AUTH, MESSAGE_ID);
    expect(result).toEqual({ action: card(), continuationRunId: 'run-next' });
  });

  it('cancel: отмена без токена API + продолжение по messageId', async () => {
    const { controller, actions, continuation } = makeController();
    await controller.cancel(USER, ACTION_ID, AUTH);
    expect(actions.cancel).toHaveBeenCalledWith(USER.id, ACTION_ID);
    expect(continuation.afterDecision).toHaveBeenCalledWith(USER, AUTH, MESSAGE_ID);
  });

  it('undo: свежий Authorization сотрудника, без продолжения пачки', async () => {
    const { controller, actions, continuation } = makeController();
    await controller.undo(USER, ACTION_ID, AUTH);
    expect(actions.undo).toHaveBeenCalledWith(USER.id, ACTION_ID, AUTH);
    expect(continuation.afterDecision).not.toHaveBeenCalled();
  });
});
