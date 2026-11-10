// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatMessage, Paginated } from '@nodus/contracts';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatKeys } from './chat-keys.js';
import { useSendChatMessage } from './send-message.js';
import { useAuthStore } from '../auth-store.js';
import { applySentMessage } from './ws-apply.js';

/**
 * Детерминированный тест шквальной отправки (#243, канон I4/patterns.md:
 * без миллисекундных ожиданий — контролируемые deferred-ответы):
 * - каждое сообщение видно в кэше СРАЗУ после клика (темп, до ответа);
 * - POST-запросы беседы сериализуются очередью (seq на сервере = порядок
 *   кликов — лента не переупорядочивается после ответов);
 * - ни одно сообщение не меняет позицию: замена темпа серверной записью
 *   происходит НА МЕСТЕ темпа, в порядке очереди;
 * - WS-эхо, обогнавшее REST, заменяет темп без дублирования;
 * - ошибка откатывает ТОЛЬКО свой темп (соседние летящие не задеты).
 */

const CONV = '11111111-1111-4111-8111-111111111111';

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const base = (id: string, seq: number, clientMessageId: string, text: string): ChatMessage => ({
  id,
  conversationId: CONV,
  seq,
  clientMessageId,
  author: { id: 'me', displayName: 'Я', avatarUrl: null },
  text,
  replyToId: null,
  reply: null,
  threadRootId: null,
  threadRepliesCount: 0,
  reactions: [],
  attachments: [],
  editedAt: null,
  deletedAt: null,
  pinned: false,
  forwardedFrom: null,
  readAt: null,
  readBy: [],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  createdAt: '2026-10-07T10:00:00Z',
});

interface Captured {
  body: { text?: string };
  key: string;
  resolve: (message: ChatMessage) => void;
  reject: (reason: unknown) => void;
}

/** FIFO-стаб POST: каждый запрос замирает до resolve/reject теста. */
function stubDeferredPost(captured: Captured[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          captured.push({
            body: JSON.parse(String(init?.body ?? '{}')) as { text?: string },
            key: headers['Idempotency-Key'] ?? '',
            resolve: (message) =>
              resolve(
                new Response(JSON.stringify(message), {
                  status: 201,
                  headers: { 'content-type': 'application/json' },
                }),
              ),
            reject,
          });
        }),
    ),
  );
}

function feed(client: QueryClient): ChatMessage[] {
  return client.getQueryData<Paginated<ChatMessage>>(chatKeys.messages(CONV))?.items ?? [];
}

const texts = (client: QueryClient): string[] => feed(client).map((m) => m.text);

function seedFeed(client: QueryClient): void {
  client.setQueryData(chatKeys.messages(CONV), {
    items: [base('a', 5, 'a', 'история')],
    nextCursor: null,
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubEnv('VITE_API_MOCK', 'false');
  // Автор темпа = автор серверной записи (связка по clientMessageId сверяет
  // и автора — ключ уникален в рамках автора, БД).
  useAuthStore.setState({
    user: { id: 'me', displayName: 'Я', email: 'me@nodus.by', permissions: [] },
  });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe('useSendChatMessage — шквальная отправка (#243)', () => {
  it('каждое сообщение видно сразу; POST-ы сериализованы; порядок неподвижен', async () => {
    const captured: Captured[] = [];
    stubDeferredPost(captured);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFeed(client);
    const { result } = renderHook(() => useSendChatMessage(CONV), {
      wrapper: makeWrapper(client),
    });

    // Шквал: три клика подряд, ни один ответ ещё не пришёл.
    await act(async () => {
      result.current.mutate({ text: 'раз' });
      result.current.mutate({ text: 'два' });
      result.current.mutate({ text: 'три' });
    });

    // Мгновенность: все три темпа в кэше ДО ответов сервера.
    expect(texts(client)).toEqual(['история', 'раз', 'два', 'три']);

    // Очередь: второй POST не стартует, пока не ответил первый.
    expect(captured.map((c) => c.body.text)).toEqual(['раз']);

    // Ответ 1: серверная запись заменяет темп НА МЕСТЕ.
    await act(async () => {
      captured[0]!.resolve(base('s1', 6, captured[0]!.key, 'раз'));
    });
    expect(texts(client)).toEqual(['история', 'раз', 'два', 'три']);
    expect(feed(client)[1]?.id).toBe('s1');
    // Очередь продвинулась: стартовал POST 2.
    expect(captured.map((c) => c.body.text)).toEqual(['раз', 'два']);

    await act(async () => {
      captured[1]!.resolve(base('s2', 7, captured[1]!.key, 'два'));
    });
    expect(texts(client)).toEqual(['история', 'раз', 'два', 'три']);
    expect(captured.map((c) => c.body.text)).toEqual(['раз', 'два', 'три']);

    await act(async () => {
      captured[2]!.resolve(base('s3', 8, captured[2]!.key, 'три'));
    });
    // Финал: порядок = порядок кликов, все записи серверные.
    expect(texts(client)).toEqual(['история', 'раз', 'два', 'три']);
    expect(
      feed(client)
        .slice(1)
        .map((m) => m.id),
    ).toEqual(['s1', 's2', 's3']);
    expect(feed(client).map((m) => m.seq)).toEqual([5, 6, 7, 8]);
  });

  it('WS-эхо обгоняет REST: темп заменён на месте, REST не дублирует', async () => {
    const captured: Captured[] = [];
    stubDeferredPost(captured);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFeed(client);
    const { result } = renderHook(() => useSendChatMessage(CONV), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ text: 'раз' });
      result.current.mutate({ text: 'два' });
    });
    expect(texts(client)).toEqual(['история', 'раз', 'два']);

    // Эхо первого прилетело из WS ДО REST-ответа.
    await act(async () => {
      const applied = applySentMessage(client, {
        conversationId: CONV,
        threadRootId: null,
        message: base('s1', 6, captured[0]!.key, 'раз'),
      });
      expect(applied).toBe(true);
    });
    expect(texts(client)).toEqual(['история', 'раз', 'два']);
    expect(feed(client)[1]?.id).toBe('s1');

    // REST-ответ того же сообщения — уже применён, дубля нет.
    await act(async () => {
      captured[0]!.resolve(base('s1', 6, captured[0]!.key, 'раз'));
    });
    expect(texts(client)).toEqual(['история', 'раз', 'два']);
    expect(feed(client).filter((m) => m.id === 's1')).toHaveLength(1);

    await act(async () => {
      captured[1]!.resolve(base('s2', 7, captured[1]!.key, 'два'));
    });
    expect(texts(client)).toEqual(['история', 'раз', 'два']);
    expect(feed(client).map((m) => m.id)).toEqual(['a', 's1', 's2']);
  });

  it('ошибка откатывает ТОЛЬКО свой темп; хвост очереди доезжает', async () => {
    const captured: Captured[] = [];
    stubDeferredPost(captured);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFeed(client);
    const { result } = renderHook(() => useSendChatMessage(CONV), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ text: 'раз' });
      result.current.mutate({ text: 'два' });
    });
    expect(texts(client)).toEqual(['история', 'раз', 'два']);

    // Первая отправка упала (сеть): её темп уходит, вторая — на месте.
    await act(async () => {
      captured[0]!.reject(new Error('network down'));
    });
    expect(texts(client)).toEqual(['история', 'два']);
    expect(captured.map((c) => c.body.text)).toEqual(['раз', 'два']);

    await act(async () => {
      captured[1]!.resolve(base('s2', 6, captured[1]!.key, 'два'));
    });
    expect(texts(client)).toEqual(['история', 'два']);
    expect(feed(client).map((m) => m.id)).toEqual(['a', 's2']);
  });

  it('рефетч ленты между отправками не съедает летящие темпы (мердж страницы)', async () => {
    const captured: Captured[] = [];
    stubDeferredPost(captured);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFeed(client);
    const { result } = renderHook(() => useSendChatMessage(CONV), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ text: 'раз' });
      result.current.mutate({ text: 'два' });
    });

    // WS-батчер зарефетчил ленту: сервер знает только историю (снимок до
    // подтверждений). Наивная замена кэша удалила бы оба темпа.
    await act(async () => {
      client.setQueryData(chatKeys.messages(CONV), {
        items: [base('a', 5, 'a', 'история')],
        nextCursor: null,
      });
    });
    expect(texts(client)).toEqual(['история']);

    // Такого быть не должно: queryFn с мерджем вернёт темпы в хвост
    // (проверяется в pending-merge.test.ts); здесь проверяем страховку
    // onSuccess против худшего случая «кэш уже затёрт».
    await act(async () => {
      captured[0]!.resolve(base('s1', 6, captured[0]!.key, 'раз'));
    });
    // REST вставляет запись перед хвостом темпов (темпов нет — в конец).
    expect(texts(client)).toEqual(['история', 'раз']);
    await act(async () => {
      captured[1]!.resolve(base('s2', 7, captured[1]!.key, 'два'));
    });
    expect(texts(client)).toEqual(['история', 'раз', 'два']);
    expect(feed(client).map((m) => m.id)).toEqual(['a', 's1', 's2']);
  });
});
