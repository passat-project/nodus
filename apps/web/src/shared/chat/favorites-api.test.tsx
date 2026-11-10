// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ConversationListItem, FavoriteCard, Paginated } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';
import {
  favoriteKeys,
  useAddFavorites,
  useRemoveFavorite,
  useUpdateFavorite,
} from './favorites-api.js';
import {
  useOptimisticFavoriteLabels,
  reconcileOptimisticLabels,
} from './optimistic-favorite-labels.js';

/**
 * Детерминированные тесты оптимистичности избранного (#171, канон I4):
 * мутация применена к кэшу ДО resolve ответа (контролируемый deferred);
 * reject → откат по снапшоту; onSuccess → серверная версия заменяет прогноз.
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const MSG = '22222222-2222-4222-8222-222222222222';

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

const author = { id: 'a-1', displayName: 'Анна Смирнова', avatarUrl: null };

const message: ChatMessage = {
  id: MSG,
  conversationId: CONV,
  seq: 3,
  clientMessageId: 'client-3',
  author,
  text: 'текст оригинала',
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
  createdAt: '2026-10-04T10:00:00Z',
};

const conversation: ConversationListItem = {
  id: CONV,
  type: 'group',
  title: 'Проект «Школа»',
  avatarUrl: null,
  myRole: 'member',
  permissions: {
    changeInfo: 'admin',
    addMembers: 'member',
    removeMembers: 'admin',
    post: 'member',
    manageSettings: 'owner',
  },
  draft: null,
  visibility: null,
  description: null,
  project: null,
  task: null,
  letter: null,
  membersPreview: [author],
  membersCount: 2,
  lastMessage: null,
  lastActivityAt: null,
  unreadCount: 0,
  myLastReadSeq: 0,
  pinned: false,
  muted: false,
  snoozed: false,
};

function card(overrides: Partial<FavoriteCard> = {}): FavoriteCard {
  return {
    messageId: MSG,
    conversationId: CONV,
    conversationTitle: 'Проект «Школа»',
    conversationType: 'group',
    threadRootId: null,
    author,
    text: 'текст оригинала',
    attachments: [],
    editedAt: null,
    deletedAt: null,
    urgent: false,
    obliterated: false,
    createdAt: '2026-10-04T10:00:00Z',
    labels: [],
    favoritedAt: '2026-10-04T11:00:00Z',
    ...overrides,
  };
}

function stubFetch(gate: Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' || method === 'PATCH' || method === 'DELETE') return gate;
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('favorites-api (#171): оптимистичность', () => {
  it('add: прогноз карточки вставлен ДО resolve; onSuccess заменяет серверной', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<Paginated<ChatMessage>>(chatKeys.messages(CONV), {
      items: [message],
      nextCursor: null,
    });
    client.setQueryData<Paginated<ConversationListItem>>(chatKeys.conversations(), {
      items: [conversation],
      nextCursor: null,
    });
    const server = card({});
    const gate = deferred<Response>();
    stubFetch(gate.promise);

    const { result } = renderHook(() => useAddFavorites(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      result.current.mutate([MSG]);
    });

    // ДО resolve: карточка-прогноз уже в первой странице (контент из кэша ленты).
    const before = client.getQueryData(favoriteKeys.list()) as unknown as
      | {
          pages: { items: FavoriteCard[] }[];
        }
      | undefined;
    expect(before?.pages?.[0]?.items.map((c) => c.messageId)).toEqual([MSG]);
    expect(before!.pages[0]!.items[0]!.text).toBe('текст оригинала');

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify({ items: [server] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
    const after = client.getQueryData(favoriteKeys.list()) as unknown as {
      pages: { items: FavoriteCard[] }[];
    };
    expect(after.pages[0]!.items).toHaveLength(1);
    expect(after.pages[0]!.items[0]!.favoritedAt).toBe(server.favoritedAt);
  });

  it('add: reject → откат по снапшоту (прогноза в кэше нет)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<Paginated<ChatMessage>>(chatKeys.messages(CONV), {
      items: [message],
      nextCursor: null,
    });
    client.setQueryData<Paginated<ConversationListItem>>(chatKeys.conversations(), {
      items: [conversation],
      nextCursor: null,
    });
    const gate = deferred<Response>();
    stubFetch(gate.promise);

    const { result } = renderHook(() => useAddFavorites(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      result.current.mutate([MSG]);
    });
    await act(async () => {
      gate.resolve(new Response('boom', { status: 500 }));
      await waitFor(() => expect(result.current.isError).toBe(true));
    });
    const after = client.getQueryData(favoriteKeys.list()) as unknown as {
      pages: { items: FavoriteCard[] }[];
    } | null;
    expect(after?.pages?.[0]?.items ?? []).toHaveLength(0);
  });

  it('update: метки патчатся ДО resolve и остаются после onSuccess', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const initial = { pages: [{ items: [card()], nextCursor: null }], pageParams: [null] };
    client.setQueryData(favoriteKeys.list(), initial as never);
    const server = card({ labels: ['🔑'] });
    const gate = deferred<Response>();
    stubFetch(gate.promise);

    const { result } = renderHook(() => useUpdateFavorite(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      result.current.mutate({ messageId: MSG, body: { labels: ['🔑'] } });
    });

    const before = client.getQueryData(favoriteKeys.list()) as unknown as {
      pages: { items: FavoriteCard[] }[];
    };
    expect(before.pages[0]!.items[0]!.labels).toEqual(['🔑']);

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify(server), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
    const after = client.getQueryData(favoriteKeys.list()) as unknown as {
      pages: { items: FavoriteCard[] }[];
    };
    expect(after.pages[0]!.items[0]!.labels).toEqual(['🔑']);
  });

  it('update (#215): тэг на записи без закладки — локальная метка ДО resolve, кэш списка НЕ трогается', async () => {
    // Ревизия приёмки: вставка прогноза-карточки в кэш списка дёргала ленту
    // на первом выставлении после загрузки страницы. Мгновенность чипов —
    // локальный оптимистичный стор (витрина мерджит его в labelTarget).
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<Paginated<ChatMessage>>(chatKeys.messages(CONV), {
      items: [message],
      nextCursor: null,
    });
    client.setQueryData<Paginated<ConversationListItem>>(chatKeys.conversations(), {
      items: [conversation],
      nextCursor: null,
    });
    const initial = { pages: [{ items: [], nextCursor: null }], pageParams: [null] };
    client.setQueryData(favoriteKeys.list(), initial as never);
    useOptimisticFavoriteLabels.getState().clear(MSG);
    const server = card({ labels: ['🔑'] });
    const gate = deferred<Response>();
    stubFetch(gate.promise);

    const { result } = renderHook(() => useUpdateFavorite(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      result.current.mutate({ messageId: MSG, body: { labels: ['🔑'] } });
    });

    expect(useOptimisticFavoriteLabels.getState().labels.get(MSG)).toEqual(['🔑']);
    const list = client.getQueryData(favoriteKeys.list()) as unknown as {
      pages: { items: FavoriteCard[] }[];
    };
    expect(list.pages[0]!.items).toHaveLength(0);

    await act(async () => {
      gate.resolve(
        new Response(JSON.stringify(server), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    // onSuccess метку НЕ снимает (карточка попадёт в кэш только после
    // рефетча — снять раньше значило мигание чипа «на секунду пропал»);
    // снимает reconcileOptimisticLabels, когда кэш догнал теми же метками.
    expect(useOptimisticFavoriteLabels.getState().labels.get(MSG)).toEqual(['🔑']);

    // Рефетч принёс карточку с теми же метками → локальная снята.
    const fetched = { pages: [{ items: [server], nextCursor: null }], pageParams: [null] };
    client.setQueryData(favoriteKeys.list(), fetched as never);
    reconcileOptimisticLabels([server]);
    expect(useOptimisticFavoriteLabels.getState().labels.has(MSG)).toBe(false);

    // Разбежались метки (сервер ещё не догнал) — локальная держится.
    useOptimisticFavoriteLabels.getState().set(MSG, ['⭐']);
    reconcileOptimisticLabels([{ messageId: MSG, labels: [] }]);
    expect(useOptimisticFavoriteLabels.getState().labels.get(MSG)).toEqual(['⭐']);
    useOptimisticFavoriteLabels.getState().clear(MSG);
  });

  it('remove: карточка исчезает ДО resolve', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const initial = { pages: [{ items: [card()], nextCursor: null }], pageParams: [null] };
    client.setQueryData(favoriteKeys.list(), initial as never);
    const gate = deferred<Response>();
    stubFetch(gate.promise);

    const { result } = renderHook(() => useRemoveFavorite(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      result.current.mutate(MSG);
    });

    const before = client.getQueryData(favoriteKeys.list()) as unknown as {
      pages: { items: FavoriteCard[] }[];
    };
    expect(before.pages[0]!.items).toHaveLength(0);

    await act(async () => {
      gate.resolve(new Response(null, { status: 204 }));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });

  it('инцидент 04.10: labels-кэш под префиксом favoriteKeys.all НЕ роняет мутацию', async () => {
    // Префикс all накрывает и запрос labels ({items} без страниц): без
    // защиты patchCard/removeCard падали TypeError'ом в onMutate — мутация
    // умирала ДО сети («не удалось сохранить изменение», сервер не тронут).
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const initial = { pages: [{ items: [card()], nextCursor: null }], pageParams: [null] };
    client.setQueryData(favoriteKeys.list(), initial as never);
    client.setQueryData(favoriteKeys.labels(), { items: ['⭐'] });
    const gate = deferred<Response>();
    stubFetch(gate.promise);

    const { result } = renderHook(() => useRemoveFavorite(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      result.current.mutate(MSG);
    });

    const before = client.getQueryData(favoriteKeys.list()) as unknown as {
      pages: { items: FavoriteCard[] }[];
    };
    expect(before.pages[0]!.items).toHaveLength(0);
    expect(client.getQueryData(favoriteKeys.labels())).toEqual({ items: ['⭐'] });

    await act(async () => {
      gate.resolve(new Response(null, { status: 204 }));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });
});
