// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEnvelope } from '@nodus/contracts';

import { invalidateNow, resetRecentInvalidations } from '../api/task-invalidate.js';
import { invalidateConversationLists } from '../chat/conversation-list-invalidation.js';
import { chatKeys } from '../chat/chat-keys.js';
import { createRealtimeInvalidator } from './socket-invalidation.js';

/**
 * Одна правка — один раунд (#1051). Мутация перезапрашивает ключи сразу;
 * эхо собственного события по WebSocket приходило следом и инвалидировало то
 * же повторно — каждая отправка и каждое прочтение шли двумя волнами.
 */

const CONV = '00000000-0000-4000-8000-0000000000c1';
const LIST = JSON.stringify(['chat', 'conversations']);

function fakeClient() {
  const invalidateQueries = vi.fn();
  return {
    invalidateQueries,
    client: {
      invalidateQueries,
      getQueryData: vi.fn(() => undefined),
      getQueriesData: vi.fn(() => []),
      setQueriesData: vi.fn(),
      setQueryData: vi.fn(),
      getQueryCache: vi.fn(() => ({ findAll: () => [] })),
    },
  };
}

const listCalls = (invalidateQueries: ReturnType<typeof vi.fn>) =>
  invalidateQueries.mock.calls.filter(
    (c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey) === LIST,
  ).length;

describe('эхо собственной мутации не повторяет раунд (#1051)', () => {
  afterEach(() => {
    resetRecentInvalidations();
    vi.useRealTimers();
  });

  it('отправка: список перезапрошен один раз — самой мутацией; эхо в окне TTL пропускает, позже — проходит', () => {
    vi.useFakeTimers();
    const start = 1_000_000;
    vi.setSystemTime(start);
    const { client, invalidateQueries } = fakeClient();
    invalidateConversationLists(client as never);
    expect(listCalls(invalidateQueries)).toBe(1);

    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle({
      type: 'chat.message_sent',
      payload: { conversationId: CONV },
      seq: 1,
      ts: '2026-11-25T00:00:00.000Z',
    } as RealtimeEnvelope);
    vi.advanceTimersByTime(700);
    expect(listCalls(invalidateQueries)).toBe(1);
    invalidator.dispose();

    vi.setSystemTime(start + 3_000);
    invalidateQueries.mockClear();
    const later = createRealtimeInvalidator(client as never);
    later.handle({
      type: 'chat.message_sent',
      payload: { conversationId: CONV },
      seq: 2,
      ts: '2026-11-25T00:00:03.000Z',
    } as RealtimeEnvelope);
    vi.advanceTimersByTime(700);
    expect(listCalls(invalidateQueries)).toBe(1);
    later.dispose();
  });

  it('эхо задачи: деталь и переходы после правки полей не рефечатся повторно', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeClient();
    void invalidateNow(client as never, ['tasks', 'detail', 't1']);
    void invalidateNow(client as never, ['tasks', 'transitions', 't1']);
    invalidateQueries.mockClear();

    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle({
      type: 'task.updated',
      payload: { taskId: 't1', fields: ['title'] },
      seq: 1,
      ts: '2026-11-25T00:00:00.000Z',
    } as RealtimeEnvelope);
    vi.advanceTimersByTime(700);
    const keys = invalidateQueries.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey),
    );
    expect(keys).not.toContain('["tasks","detail","t1"]');
    expect(keys).not.toContain('["tasks","transitions","t1"]');
    // Журнал и ветки — догоняет эхо (мутация их лишь пометила устаревшими).
    expect(keys).toContain('["tasks","list-pages"]');
    invalidator.dispose();
  });

  it('правка имени не перезапрашивает агрегаты узлов структуры (#467)', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle({
      type: 'task.updated',
      payload: { taskId: 't1', fields: ['title', 'priority'] },
      seq: 1,
      ts: '2026-11-25T00:00:00.000Z',
    } as RealtimeEnvelope);
    vi.advanceTimersByTime(700);
    const keys = invalidateQueries.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey),
    );
    expect(keys.some((k) => k.includes('structure'))).toBe(false);
    invalidator.dispose();
  });

  it('инвалидация списков бесед не задевает find-or-create соседей', () => {
    const { client, invalidateQueries } = fakeClient();
    invalidateConversationLists(client as never);
    const keys = invalidateQueries.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey),
    );
    expect(keys).toContain(LIST);
    expect(keys).toContain(JSON.stringify(chatKeys.unreadSummary()));
    expect(keys).toContain(JSON.stringify([...chatKeys.conversations(), 'scope']));
    for (const neighbour of [
      chatKeys.byTask('t1'),
      chatKeys.byLetter('l1'),
      chatKeys.byProject('p1'),
    ]) {
      expect(keys).not.toContain(JSON.stringify(neighbour));
    }
    void client;
  });
});
