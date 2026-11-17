import { describe, expect, it } from 'vitest';
import type { AssistantAction, AssistantMessage } from '@nodus/contracts';

import { batchFor, groupActionsByMessage } from './assistant-batch-state.js';

/**
 * Состояние пачки в ленте (#916): группировка карточек по ходу агента и
 * снимок «решено N из M». Серверный снимок важнее расчёта живого потока —
 * после перечитывания истории показываем то, что в БД.
 */

const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';

function action(overrides: Partial<AssistantAction> = {}): AssistantAction {
  return {
    id: crypto.randomUUID(),
    messageId: MESSAGE_ID,
    toolId: 'tasks.create',
    title: 'Задачи: создать',
    summary: 'Создать задачу',
    fields: [],
    consequences: 'Появится в журнале',
    undoable: true,
    automatic: false,
    state: 'proposed',
    resultPreview: null,
    href: null,
    hrefLabel: null,
    errorCode: null,
    createdAt: '2026-11-17T10:00:00.000Z',
    executedAt: null,
    undoneAt: null,
    ...overrides,
  };
}

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: MESSAGE_ID,
    role: 'assistant',
    text: 'Готово',
    reasoning: null,
    createdAt: '2026-11-17T10:00:00.000Z',
    runId: null,
    streaming: false,
    errorCode: null,
    toolCalls: [],
    actions: [],
    actionBatch: null,
    ...overrides,
  };
}

describe('groupActionsByMessage (#916)', () => {
  it('группирует по сообщению, живые без messageId — в «live»', () => {
    const groups = groupActionsByMessage([
      action({ messageId: 'm-1' }),
      action({ messageId: 'm-1' }),
      action({ messageId: null }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]![0]).toBe('m-1');
    expect(groups[0]![1]).toHaveLength(2);
    expect(groups[1]![0]).toBe('live');
  });
});

describe('batchFor (#916)', () => {
  it('серверный снимок важнее расчёта по карточкам', () => {
    const server = { state: 'continued' as const, total: 3, decided: 3, pending: 0 };
    expect(batchFor(MESSAGE_ID, [action()], [message({ actionBatch: server })])).toEqual(server);
  });

  it('без снимка считает по состояниям карточек живого потока', () => {
    const actions = [action({ state: 'executed' }), action({ state: 'proposed' })];
    expect(batchFor(MESSAGE_ID, actions, [])).toEqual({
      state: 'open',
      total: 2,
      decided: 1,
      pending: 1,
    });
  });

  it('executing тоже считается ожидающей карточкой', () => {
    expect(batchFor(MESSAGE_ID, [action({ state: 'executing' })], []).pending).toBe(1);
  });
});
