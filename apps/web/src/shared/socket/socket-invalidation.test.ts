// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { RealtimeEnvelope } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { useCommentsLive } from '../tasks/comments-live.js';
import { createRealtimeInvalidator } from './socket-invalidation.js';

/** queryClient-шпион: фиксирует инвалидированные ключи; кэшей нет (ws-apply
 *  вернёт false — message_sent обязан дойти до коалесцированного рефеча). */
function fakeQueryClient() {
  const invalidateQueries = vi.fn();
  const getQueryData = vi.fn(() => undefined);
  // ws-apply патчеры зовут setQueriesData/setQueryData — кэшей нет, патч не применяется.
  const setQueriesData = vi.fn();
  const setQueryData = vi.fn();
  // Поиск беседы задачи по кэшам списка (#252) — кэшей нет.
  const getQueriesData = vi.fn(() => []);
  // Колонки досок в кэше (#322) — досок нет.
  const getQueryCache = vi.fn(() => ({ findAll: () => [] }));
  return {
    client: {
      invalidateQueries,
      getQueryData,
      setQueriesData,
      setQueryData,
      getQueriesData,
      getQueryCache,
    },
    invalidateQueries,
  };
}

function envelope(type: string, payload: Record<string, unknown>): RealtimeEnvelope {
  return { type, payload, seq: 1, ts: '2026-09-25T00:00:00.000Z' };
}

const CONV = '00000000-0000-4000-8000-0000000000c1';
const ME = '00000000-0000-4000-8000-0000000000me'.replace('me', '01');

/** Прокрутить ярусы окон батчера (feed 150 / list 600 мс). */
function flushWindows(): void {
  vi.advanceTimersByTime(700);
}

describe('createRealtimeInvalidator (коалесцинг, раунд 3)', () => {
  it('message_sent без DTO в кэше: лента + состояния трэдов + список (по окнам)', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('chat.message_sent', { conversationId: CONV }));
    flushWindows();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'messages', CONV] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'threadStates', CONV] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'conversations'] });
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('бурст 30 событий одной беседы: каждый ключ ОДИН раз за окно (гистерезис)', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    for (let i = 0; i < 30; i += 1) {
      invalidator.handle(envelope('chat.message_sent', { conversationId: CONV, seq: i + 1 }));
    }
    flushWindows();
    const calls = invalidateQueries.mock.calls.filter(
      (c) => (c[0] as { queryKey: unknown[] }).queryKey[1] === 'conversations',
    );
    expect(calls.length).toBe(1);
    const feed = invalidateQueries.mock.calls.filter(
      (c) => (c[0] as { queryKey: unknown[] }).queryKey[1] === 'messages',
    );
    expect(feed.length).toBe(1);
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('attachment_updated: лента беседы + файловые ключи вложения (#182)', () => {
    vi.useFakeTimers();
    const FILE = '00000000-0000-4000-8000-0000000000f1';
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(
      envelope('chat.attachment_updated', { conversationId: CONV, fileId: FILE, version: 2 }),
    );
    flushWindows();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'messages', CONV] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['files', FILE] });
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('message_read без кэша для патча: лента + состояния, список НЕ трогает', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('chat.message_read', { conversationId: CONV, userId: 'reader-1' }));
    flushWindows();
    // Шторм квитанций (#124): список бесед на чужие read больше не инвалидируется.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'messages', CONV] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'threadStates', CONV] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['chat', 'conversations'] });
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('message_read СВОЙ — тишина (бейдж гасит успех POST /read)', () => {
    vi.useFakeTimers();
    useAuthStore.setState({
      user: { id: ME, displayName: 'Я', email: 'me@nodus.by', permissions: [] },
    });
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('chat.message_read', { conversationId: CONV, userId: ME }));
    flushWindows();
    expect(invalidateQueries).not.toHaveBeenCalled();
    invalidator.dispose();
    vi.useRealTimers();
    useAuthStore.setState({ user: null });
  });

  it('reaction_added: только лента беседы (и состояния трэдов)', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('chat.reaction_added', { conversationId: CONV }));
    flushWindows();
    // Сообщения нет в кэше → локальный патч невозможен → рефеч ЛЕНТЫ без
    // состояний трэдов (реакции их не меняют; чипы в кэше патчит ws-apply).
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'messages', CONV] });
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('message_pinned: лента + закрепы', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('chat.message_pinned', { conversationId: CONV }));
    flushWindows();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'messages', CONV] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'pins', CONV] });
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('conversation_created: список бесед без ленты', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('chat.conversation_created', { memberIds: [] }));
    flushWindows();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat', 'conversations'] });
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('task.comments_counted (#252): точное значение счётчика без инвалидаций', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('task.comments_counted', { taskId: 't-1', commentsCount: 7 }));
    flushWindows();
    expect(useCommentsLive.getState().exact['t-1']).toBe(7);
    expect(invalidateQueries).not.toHaveBeenCalled();
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('message_sent в беседе задачи (#252): +1 к живому счётчику один раз', () => {
    vi.useFakeTimers();
    const { client } = fakeQueryClient();
    client.getQueriesData.mockReturnValue([
      [['chat', 'conversations'], { items: [{ id: CONV, task: { id: 't-2' } }], nextCursor: null }],
    ] as never);
    const invalidator = createRealtimeInvalidator(client as never);
    const sent = envelope('chat.message_sent', { conversationId: CONV, messageId: 'm-1', seq: 3 });
    invalidator.handle(sent);
    invalidator.handle(sent);
    expect(useCommentsLive.getState().delta['t-2']).toBe(1);
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('неизвестное событие и событие без беседы — тишина', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('chat.unknown_event', {}));
    invalidator.handle(envelope('chat.reaction_added', {}));
    flushWindows();
    expect(invalidateQueries).not.toHaveBeenCalled();
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('task.* (#311, #322): деталь и переходы задачи + счётчики/журнал, каждый ключ один раз', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('task.stage_changed', { taskId: 't-1' }));
    invalidator.handle(envelope('task.updated', { taskId: 't-1' }));
    flushWindows();
    const keys = invalidateQueries.mock.calls.map((c) => JSON.stringify(c[0].queryKey));
    expect(keys).toContain(JSON.stringify(['tasks', 'detail', 't-1']));
    expect(keys).toContain(JSON.stringify(['tasks', 'transitions', 't-1']));
    // Досок в кэше нет — колонки не рефечатся; стадия сменилась → счётчики.
    expect(keys).not.toContain(JSON.stringify(['tasks', 'kanban']));
    expect(keys).toContain(JSON.stringify(['tasks', 'personal-stages']));
    expect(keys).toContain(JSON.stringify(['tasks', 'list-pages']));
    expect(new Set(keys).size).toBe(keys.length);
    invalidator.dispose();
    vi.useRealTimers();
  });

  it('chat.sticker_* (#318): пикер паков и окно затронутого пака — по быстрому окну', () => {
    vi.useFakeTimers();
    const { client, invalidateQueries } = fakeQueryClient();
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle(envelope('chat.sticker_added', { packId: 'p-1', stickerId: 's-1' }));
    invalidator.handle(envelope('chat.sticker_pack_installed', { packId: 'p-1', userId: ME }));
    flushWindows();
    const keys = invalidateQueries.mock.calls.map((c) => JSON.stringify(c[0].queryKey));
    expect(keys.sort()).toEqual(
      [
        JSON.stringify(['chat', 'stickers', 'packs']),
        JSON.stringify(['chat', 'stickers', 'packs', 'p-1']),
      ].sort(),
    );
    invalidator.dispose();
    vi.useRealTimers();
  });
});
