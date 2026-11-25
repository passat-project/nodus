// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem, RealtimeEnvelope } from '@nodus/contracts';

import { invalidateNow, resetRecentInvalidations } from '../api/task-invalidate.js';
import { markFreshFromMutation } from '../api/fresh-from-mutation.js';
import { useAuthStore } from '../auth-store.js';
import { chatKeys } from '../chat/chat-keys.js';
import { invalidateConversationLists } from '../chat/conversation-list-invalidation.js';
import { createRealtimeInvalidator } from './socket-invalidation.js';

/**
 * Одна правка — один раунд (#1051). Мутация перезапрашивает ключи сразу; эхо
 * собственного события по WebSocket приходило следом и инвалидировало то же
 * повторно — каждая отправка и каждое чтение шли двумя волнами. Гасится только
 * СВОЁ эхо: прежде окно глушило по одному факту «ключ перезапрошен недавно» —
 * и правка коллеги в те же две секунды терялась.
 */

const ME = '00000000-0000-4000-8000-0000000000a1';
const COLLEAGUE = '00000000-0000-4000-8000-0000000000a2';
const CONV = '00000000-0000-4000-8000-0000000000c1';
const OTHER_CONVERSATION = '00000000-0000-4000-8000-0000000000c2';
const LIST = JSON.stringify(['chat', 'conversations']);
const TASK_DETAIL = JSON.stringify(['tasks', 'detail', 't1']);

const key = (k: readonly unknown[]) => JSON.stringify(k);

const event = (
  type: string,
  payload: Record<string, unknown>,
  actorId?: string,
): RealtimeEnvelope =>
  ({
    type,
    payload,
    seq: 1,
    ts: '2026-11-25T00:00:00.000Z',
    ...(actorId ? { actorId } : {}),
  }) as RealtimeEnvelope;

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

/** Реальный клиент с кэшем: строка беседы задачи, deep-link к ней, канал проекта. */
function rowsClient() {
  const client = new QueryClient();
  const row = (id: string): ConversationListItem => ({ id }) as ConversationListItem;
  client.setQueryData(chatKeys.byTask('t1'), row(CONV));
  client.setQueryData(chatKeys.conversationLookup(CONV), row(CONV));
  client.setQueryData(chatKeys.byProject('p1'), row(OTHER_CONVERSATION));
  return { client, invalidateQueries: vi.spyOn(client, 'invalidateQueries') };
}

const listCalls = (invalidateQueries: ReturnType<typeof vi.fn>) =>
  invalidateQueries.mock.calls.filter(
    (c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey) === LIST,
  ).length;

const invalidated = (invalidateQueries: ReturnType<typeof vi.fn>): string[] =>
  invalidateQueries.mock.calls.map((c) =>
    JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey),
  );

describe('эхо собственной мутации не повторяет раунд (#1051)', () => {
  afterEach(() => {
    resetRecentInvalidations();
    useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null });
    vi.useRealTimers();
  });

  it('отправка: список перезапрошен один раз — самой мутацией; своё эхо в окне TTL пропускает, позже — проходит', () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 't',
      user: { id: ME, email: 'me@nodus.by', displayName: 'Я', permissions: [] },
    });
    const start = 1_000_000;
    vi.setSystemTime(start);
    const { client, invalidateQueries } = fakeClient();
    invalidateConversationLists(client as never);
    expect(listCalls(invalidateQueries)).toBe(1);

    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(event('chat.message_sent', { conversationId: CONV }, ME));
    vi.advanceTimersByTime(700);
    expect(listCalls(invalidateQueries)).toBe(1);
    invalidator.dispose();

    vi.setSystemTime(start + 3_000);
    invalidateQueries.mockClear();
    const later = createRealtimeInvalidator(client as never);
    later.handle(event('chat.message_sent', { conversationId: CONV }, ME));
    vi.advanceTimersByTime(700);
    expect(listCalls(invalidateQueries)).toBe(1);
    later.dispose();
  });

  it('правка коллеги в те же две секунды НЕ теряется: списки и деталь перечитываются', () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 't',
      user: { id: ME, email: 'me@nodus.by', displayName: 'Я', permissions: [] },
    });
    const { client, invalidateQueries } = fakeClient();
    void invalidateNow(client as never, ['tasks', 'detail', 't1']);
    invalidateConversationLists(client as never);
    invalidateQueries.mockClear();

    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(event('task.updated', { taskId: 't1', fields: ['title'] }, COLLEAGUE));
    invalidator.handle(event('chat.message_sent', { conversationId: CONV }, COLLEAGUE));
    vi.advanceTimersByTime(700);

    expect(invalidated(invalidateQueries)).toContain(TASK_DETAIL);
    expect(listCalls(invalidateQueries)).toBe(1);
    invalidator.dispose();
  });

  it('событие без автора (системное, старый gateway) не гасится', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeClient();
    void invalidateNow(client as never, ['tasks', 'detail', 't1']);
    invalidateQueries.mockClear();

    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(event('task.overdue', { taskId: 't1' }));
    vi.advanceTimersByTime(700);

    // Пропущенное реальное изменение дороже лишнего запроса.
    expect(invalidated(invalidateQueries)).toContain(TASK_DETAIL);
    invalidator.dispose();
  });

  it('эхо задачи: деталь и переходы после правки полей не рефечатся повторно', () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 't',
      user: { id: ME, email: 'me@nodus.by', displayName: 'Я', permissions: [] },
    });
    const { client, invalidateQueries } = fakeClient();
    void invalidateNow(client as never, ['tasks', 'detail', 't1']);
    void invalidateNow(client as never, ['tasks', 'transitions', 't1']);
    invalidateQueries.mockClear();

    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(event('task.updated', { taskId: 't1', fields: ['title'] }, ME));
    vi.advanceTimersByTime(700);
    const keys = invalidated(invalidateQueries);
    expect(keys).not.toContain(TASK_DETAIL);
    expect(keys).not.toContain('["tasks","transitions","t1"]');
    // Журнал и ветки — догоняет эхо (мутация их лишь пометила устаревшими).
    expect(keys).toContain('["tasks","list-pages"]');
    invalidator.dispose();
  });

  it('панель процесса (#378): записанное из ответа своё эхо не перечитывает, чужая правка — перечитывает', () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 't',
      user: { id: ME, email: 'me@nodus.by', displayName: 'Я', permissions: [] },
    });
    const { client, invalidateQueries } = fakeClient();
    markFreshFromMutation('t1');
    const invalidator = createRealtimeInvalidator(client as never);

    invalidator.handle(
      event('task.stage_changed', { taskId: 't1', fromStageId: 's1', toStageId: 's2' }, ME),
    );
    vi.advanceTimersByTime(700);
    expect(invalidated(invalidateQueries)).not.toContain(TASK_DETAIL);

    invalidateQueries.mockClear();
    invalidator.handle(event('task.updated', { taskId: 't1', fields: ['priority'] }, COLLEAGUE));
    vi.advanceTimersByTime(700);
    expect(invalidated(invalidateQueries)).toContain(TASK_DETAIL);
    invalidator.dispose();
  });

  it('правка имени не перезапрашивает агрегаты узлов структуры (#467)', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(event('task.updated', { taskId: 't1', fields: ['title', 'priority'] }));
    vi.advanceTimersByTime(700);
    expect(invalidated(invalidateQueries).some((k) => k.includes('structure'))).toBe(false);
    invalidator.dispose();
  });

  it('строка беседы в карточке перечитывается событием своей беседы — и только своей', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = rowsClient();
    const invalidator = createRealtimeInvalidator(client);
    const taskRow = JSON.stringify(chatKeys.byTask('t1'));
    const projectRow = JSON.stringify(chatKeys.byProject('p1'));

    // Чужой чат (канал проекта): строка беседы задачи не трогается.
    invalidator.handle(
      event('chat.message_sent', { conversationId: OTHER_CONVERSATION }, COLLEAGUE),
    );
    vi.advanceTimersByTime(700);
    expect(invalidated(invalidateQueries)).toContain(projectRow);
    expect(invalidated(invalidateQueries)).not.toContain(taskRow);

    // Сообщение в беседе задачи: её строки (вкладка карточки, deep-link) живые.
    invalidateQueries.mockClear();
    invalidator.handle(event('chat.message_sent', { conversationId: CONV }, COLLEAGUE));
    vi.advanceTimersByTime(700);
    const keys = invalidated(invalidateQueries);
    expect(keys).toContain(taskRow);
    expect(keys).toContain(JSON.stringify(chatKeys.conversationLookup(CONV)));
    expect(keys).not.toContain(projectRow);
    // Список — один раунд на окно, не по числу строк.
    expect(listCalls(invalidateQueries)).toBe(1);
    invalidator.dispose();
  });

  it('своё сообщение строку беседы не перечитывает: своё непрочитанным не считается', () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 't',
      user: { id: ME, email: 'me@nodus.by', displayName: 'Я', permissions: [] },
    });
    const { client, invalidateQueries } = rowsClient();
    const invalidator = createRealtimeInvalidator(client);

    invalidator.handle(event('chat.message_sent', { conversationId: CONV }, ME));
    vi.advanceTimersByTime(700);

    expect(invalidated(invalidateQueries)).not.toContain(JSON.stringify(chatKeys.byTask('t1')));
    invalidator.dispose();
  });

  it('меня исключили из беседы или сменили мою роль — куст бесед перечитывается целиком', () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 't',
      user: { id: ME, email: 'me@nodus.by', displayName: 'Я', permissions: [] },
    });
    const { client, invalidateQueries } = rowsClient();
    const invalidator = createRealtimeInvalidator(client);
    // Куст — одним префиксом (без точечного набора списков), за ним — сама беседа:
    // доступ отозван или роль сменилась, сервер своим ответом заменяет кэш.
    const aboutMe = [
      LIST,
      ...[
        chatKeys.messages(CONV),
        chatKeys.pins(CONV),
        chatKeys.threadStates(CONV),
        chatKeys.members(CONV),
      ].map(key),
    ];

    invalidator.handle(
      event('chat.member_removed', { conversationId: CONV, userId: ME }, COLLEAGUE),
    );
    vi.advanceTimersByTime(200);
    expect(invalidated(invalidateQueries)).toEqual(aboutMe);
    expect(invalidateQueries.mock.calls[0]![0]).toEqual({ queryKey: chatKeys.conversations() });

    // Мой же выход (эхо моей мутации) — то же: гашение здесь недопустимо.
    invalidateQueries.mockClear();
    invalidator.handle(event('chat.member_role_changed', { conversationId: CONV, userId: ME }, ME));
    vi.advanceTimersByTime(200);
    expect(invalidated(invalidateQueries)).toEqual(aboutMe);

    // Исключили ДРУГОГО: моя беседа и мой доступ не тронуты.
    invalidateQueries.mockClear();
    invalidator.handle(
      event('chat.member_removed', { conversationId: CONV, userId: COLLEAGUE }, ME),
    );
    vi.advanceTimersByTime(700);
    expect(invalidated(invalidateQueries)).not.toContain(key(chatKeys.messages(CONV)));
    expect(invalidateQueries.mock.calls.some((c) => JSON.stringify(c[0]?.queryKey) === LIST)).toBe(
      true,
    );
    invalidator.dispose();
  });

  it('списки бесед обновляются точечно: find-or-create соседей не трогают', () => {
    const { client, invalidateQueries } = fakeClient();
    invalidateConversationLists(client as never);
    const keys = invalidated(invalidateQueries);
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
  });
});
