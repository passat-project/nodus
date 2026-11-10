// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Paginated } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { chatKeys } from './chat-keys.js';
import { useDeleteMessage } from './delete-message-mutations.js';
import { useEditMessage } from './edit-message-mutation.js';
import { predictReactions, useReactionToggle } from './reaction-mutations.js';

/**
 * Детерминированные тесты оптимистичности (канон I4/patterns.md): мутация
 * применена к кэшу ДО resolve ответа сервера (контролируемый deferred, без
 * миллисекундных ожиданий); reject → откат по снапшоту.
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const M1 = '22222222-2222-4222-8222-222222222222';

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client } satisfies QueryClientProviderProps,
      children,
    );
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: M1,
  conversationId: CONV,
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'me', displayName: 'Я', avatarUrl: null },
  text: 'исходный текст',
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
  readAt: '2026-09-24T10:00:00Z',
  readBy: [],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  createdAt: '2026-09-24T09:00:00Z',
  ...overrides,
});

function seed(client: QueryClient, m: ChatMessage) {
  const page: Paginated<ChatMessage> = { items: [m], nextCursor: null };
  client.setQueryData(chatKeys.messages(CONV), page);
}

function items(client: QueryClient): ChatMessage[] {
  return (client.getQueryData(chatKeys.messages(CONV)) as Paginated<ChatMessage>).items;
}

function stubFetch(gate: Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PATCH' || method === 'DELETE') return gate;
      return new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('useEditMessage — оптимистичность (A4)', () => {
  it('текст/editedAt/readAt=null в кэше ДО ответа сервера, onSuccess — серверная версия', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client, message());
    const gate = deferred<Response>();
    stubFetch(gate.promise);
    const { result } = renderHook(() => useEditMessage(CONV), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({ messageId: M1, text: 'новый текст' });
    });

    // Оптимистично: до resolve.
    let cached = items(client)[0];
    expect(cached?.text).toBe('новый текст');
    expect(cached?.editedAt).not.toBeNull();
    // «Повторный пуш прочитавшим» (решение #41): галочки read → sent.
    expect(cached?.readAt).toBeNull();

    const server = message({ text: 'новый текст', editedAt: '2026-09-24T11:00:00Z', readAt: null });
    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify(server), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    cached = items(client)[0];
    expect(cached?.editedAt).toBe('2026-09-24T11:00:00Z');
  });

  it('ошибка сервера — откат по снапшоту', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client, message());
    const gate = deferred<Response>();
    stubFetch(gate.promise);
    const { result } = renderHook(() => useEditMessage(CONV), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({ messageId: M1, text: 'новый текст' });
    });
    expect(items(client)[0]?.text).toBe('новый текст');

    await act(async () => {
      gate.reject(new Error('network'));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const rolled = items(client)[0];
    expect(rolled?.text).toBe('исходный текст');
    expect(rolled?.editedAt).toBeNull();
    expect(rolled?.readAt).toBe('2026-09-24T10:00:00Z');
  });

  it('состав вложений (#188): оптимистичный список ДО ответа, PATCH несёт attachmentIds/renames', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(
      client,
      message({
        attachments: [
          {
            id: 'att-old',
            fileId: 'f1',
            name: 'старое.png',
            size: 10,
            mime: 'image/png',
            kind: 'image',
            url: null,
            thumbnailUrl: null,
            previewKind: 'image',
            pdfUrl: null,
            width: null,
            height: null,
          },
        ],
      }),
    );
    const gate = deferred<Response>();
    stubFetch(gate.promise);
    const { result } = renderHook(() => useEditMessage(CONV), { wrapper: makeWrapper(client) });

    const optimistic = [
      {
        id: 'att-new',
        fileId: 'f2',
        name: 'новое имя.png',
        size: 20,
        mime: 'image/png',
        kind: 'image' as const,
        url: null,
        thumbnailUrl: null,
        previewKind: 'image' as const,
        pdfUrl: null,
        width: null,
        height: null,
      },
    ];
    await act(async () => {
      result.current.mutate({
        messageId: M1,
        text: 'с новым вложением',
        attachmentIds: ['att-new'],
        attachmentRenames: [{ id: 'att-new', name: 'новое имя.png' }],
        optimisticAttachments: optimistic,
      });
    });

    // Оптимистично (I4): состав в кэше до ответа сервера.
    const cached = items(client)[0];
    expect(cached?.attachments).toEqual(optimistic);
    // Тело запроса несёт полный состав + переименование.
    const patch = vi
      .mocked(fetch)
      .mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH');
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({
      text: 'с новым вложением',
      attachmentIds: ['att-new'],
      attachmentRenames: [{ id: 'att-new', name: 'новое имя.png' }],
    });

    const server = message({ text: 'с новым вложением', attachments: optimistic });
    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify(server), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(items(client)[0]?.attachments).toEqual(optimistic);
  });
});

describe('useDeleteMessage — прогноз правила следа «по ответам» (#163)', () => {
  const REPLY_ID = '33333333-3333-4333-8333-333333333333';
  const replyOn = (id: string, targetId: string): ChatMessage =>
    message({
      id,
      replyToId: targetId,
      reply: {
        id: targetId,
        author: { id: 'peer', displayName: 'Собеседник', avatarUrl: null },
        text: 'цитата',
        quoteText: null,
        attachmentKind: null,
        deleted: false,
        obliterated: false,
      },
    });

  function seedAll(client: QueryClient, list: ChatMessage[]) {
    client.setQueryData(chatKeys.messages(CONV), { items: list, nextCursor: null });
  }

  it('есть живой ответ — оптимистичное надгробие ДО ответа; сервер подтверждает', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedAll(client, [message({ readAt: null }), replyOn(REPLY_ID, M1)]);
    const gate = deferred<Response>();
    stubFetch(gate.promise);
    const { result } = renderHook(() => useDeleteMessage(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({ conversationId: CONV, messageId: M1 });
    });
    let cached = items(client)[0];
    expect(cached?.deletedAt).not.toBeNull();
    expect(cached?.text).toBe('');

    const tombstone = message({ deletedAt: '2026-09-24T12:00:00Z', text: '', readAt: null });
    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify(tombstone), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    cached = items(client)[0];
    expect(cached?.deletedAt).toBe('2026-09-24T12:00:00Z');
  });

  it('ответов нет — исчезает бесследно (204), даже если прочитано', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedAll(client, [message({ readAt: '2026-09-24T10:00:00Z' })]);
    const gate = deferred<Response>();
    stubFetch(gate.promise);
    const { result } = renderHook(() => useDeleteMessage(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({ conversationId: CONV, messageId: M1 });
    });
    expect(items(client)).toHaveLength(0);

    await act(async () => {
      gate.resolve(new Response(null, { status: 204 }));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(items(client)).toHaveLength(0);
  });

  it('прогноз разошёлся (ответ вне окна кэша) — серверная истина: надгробие появляется', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedAll(client, [message({ readAt: null })]);
    const gate = deferred<Response>();
    stubFetch(gate.promise);
    const { result } = renderHook(() => useDeleteMessage(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({ conversationId: CONV, messageId: M1 });
    });
    expect(items(client)).toHaveLength(0);

    const tombstone = message({ deletedAt: '2026-09-24T12:00:00Z', text: '' });
    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify(tombstone), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Сервер вернул надгробие — оно должно появиться в кэше, хоть прогноз был «удалить».
    const cached = items(client);
    expect(cached.some((m) => m.id === M1 && m.deletedAt !== null)).toBe(true);
  });
});

const ME_REF = { id: 'me', displayName: 'Я', avatarUrl: null };
const U2_REF = { id: 'u2', displayName: 'Другой', avatarUrl: null };

describe('predictReactions (#124)', () => {
  it('add в пустой / инкремент чужой / no-op своей / remove до нуля (users следом)', () => {
    expect(predictReactions(message(), '🔥', false, ME_REF)).toEqual([
      { emoji: '🔥', count: 1, mine: true, users: [ME_REF] },
    ]);
    const others = message({
      reactions: [{ emoji: '🔥', count: 1, mine: false, users: [U2_REF] }],
    });
    expect(predictReactions(others, '🔥', false, ME_REF)).toEqual([
      { emoji: '🔥', count: 2, mine: true, users: [U2_REF, ME_REF] },
    ]);
    const mine = message({
      reactions: [{ emoji: '🔥', count: 2, mine: true, users: [ME_REF, U2_REF] }],
    });
    expect(predictReactions(mine, '🔥', false, ME_REF)).toBe(mine.reactions);
    expect(predictReactions(mine, '🔥', true, ME_REF)).toEqual([
      { emoji: '🔥', count: 1, mine: false, users: [U2_REF] },
    ]);
    const solo = message({ reactions: [{ emoji: '🔥', count: 1, mine: true, users: [ME_REF] }] });
    expect(predictReactions(solo, '🔥', true, ME_REF)).toEqual([]);
  });
});

describe('useReactionToggle — оптимистичность (#124)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'me', displayName: 'Я', email: 'me@nodus.by', permissions: [] },
    });
  });
  afterEach(() => {
    useAuthStore.setState({ user: null });
  });
  function stubPost(gate: Promise<Response>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'POST') return gate;
        return new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
  }

  it('add: чип mine:true ДО ответа; ошибка — откат по снапшоту', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client, message());
    const gate = deferred<Response>();
    stubPost(gate.promise);
    const { result } = renderHook(() => useReactionToggle(CONV), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ messageId: M1, emoji: '👍', remove: false });
    });
    expect(items(client)[0]?.reactions).toEqual([
      { emoji: '👍', count: 1, mine: true, users: [ME_REF] },
    ]);

    await act(async () => {
      gate.reject(new Error('boom'));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(items(client)[0]?.reactions).toEqual([]);
  });

  it('remove своей: декремент до ответа; onSuccess — серверная версия', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(
      client,
      message({ reactions: [{ emoji: '👍', count: 2, mine: true, users: [ME_REF, U2_REF] }] }),
    );
    const gate = deferred<Response>();
    stubPost(gate.promise);
    const { result } = renderHook(() => useReactionToggle(CONV), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ messageId: M1, emoji: '👍', remove: true });
    });
    expect(items(client)[0]?.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false, users: [U2_REF] },
    ]);

    const server = message({
      reactions: [{ emoji: '👍', count: 1, mine: false, users: [U2_REF] }],
    });
    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify(server), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(items(client)[0]?.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false, users: [U2_REF] },
    ]);
  });
});
