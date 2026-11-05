// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem, Paginated } from '@nodus/contracts';

import { api } from '../api-client.js';
import { chatKeys } from './chat-keys.js';
import { useActiveConversation, useConversationLookup } from './chat-queries.js';

/**
 * #225: deep-link на беседу за пределами первой страницы списка — поиск по
 * страницам scope=all (по 100), а не «Выберите беседу». Потолок — 5 страниц;
 * при уже загруженной беседе запрос не уходит.
 */

vi.mock('../api-client.js', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

const conv = (id: string): ConversationListItem =>
  ({ id, type: 'group', title: id }) as ConversationListItem;

const page = (
  items: ConversationListItem[],
  nextCursor: string | null,
): Paginated<ConversationListItem> => ({ items, nextCursor });

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function renderLookup(
  id: string,
  enabled = true,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return renderHook(() => useConversationLookup(id, enabled), {
    wrapper: makeWrapper(client),
  });
}

describe('useConversationLookup (#225)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('находит беседу на второй странице списка', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(page([conv('a')], 'c1'))
      .mockResolvedValueOnce(page([conv('target')], null));
    const { result } = renderLookup('target');

    await waitFor(() => expect(result.current.data?.id).toBe('target'));
    expect(vi.mocked(api).mock.calls[0]?.[0]).toBe('/chat/conversations?limit=100');
    expect(vi.mocked(api).mock.calls[1]?.[0]).toBe('/chat/conversations?limit=100&cursor=c1');
  });

  it('беседы нет ни на одной странице — null', async () => {
    vi.mocked(api).mockResolvedValueOnce(page([conv('a')], null));
    const { result } = renderLookup('target');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('потолок — 5 страниц, дальше не листает', async () => {
    vi.mocked(api).mockResolvedValue(page([conv('a')], 'c'));
    const { result } = renderLookup('target');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(vi.mocked(api)).toHaveBeenCalledTimes(5);
  });

  it('найденная беседа дописывается в первую страницу списка', async () => {
    vi.mocked(api).mockResolvedValueOnce(page([conv('target')], null));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.conversations(), page([conv('a')], 'c1'));
    const { result } = renderLookup('target', true, client);

    await waitFor(() => expect(result.current.data?.id).toBe('target'));
    const list = client.getQueryData<Paginated<ConversationListItem>>(chatKeys.conversations());
    expect(list?.items.map((c) => c.id)).toEqual(['a', 'target']);
  });

  it('при уже загруженной беседе запрос не уходит', () => {
    const { result } = renderLookup('target', false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(api).not.toHaveBeenCalled();
  });
});

describe('useActiveConversation (#225)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderActive(
    id: string,
    tabItems: ConversationListItem[],
    loaded: ConversationListItem[] | undefined,
    listReady = true,
  ) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return {
      client,
      ...renderHook(() => useActiveConversation(id, tabItems, loaded, listReady), {
        wrapper: makeWrapper(client),
      }),
    };
  }

  it('беседа из вкладки — сразу, без запроса', () => {
    const { result } = renderActive('a', [conv('a')], undefined);
    expect(result.current?.id).toBe('a');
    expect(api).not.toHaveBeenCalled();
  });

  it('беседа из первой страницы scope=all — без запроса', () => {
    const { result } = renderActive('a', [], [conv('a')]);
    expect(result.current?.id).toBe('a');
    expect(api).not.toHaveBeenCalled();
  });

  it('пока список не загрузился, поиск не стартует', () => {
    const { result } = renderActive('target', [], undefined, false);
    expect(result.current).toBeUndefined();
    expect(api).not.toHaveBeenCalled();
  });

  it('беседа за пределами загруженного — находится поиском по страницам', async () => {
    vi.mocked(api).mockResolvedValueOnce(page([conv('target')], null));
    const { result } = renderActive('target', [], []);
    await waitFor(() => expect(result.current?.id).toBe('target'));
  });

  it('после первого поиска повторный скан не запускается', async () => {
    vi.mocked(api).mockResolvedValueOnce(page([conv('target')], null));
    let loaded: ConversationListItem[] = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(
      () => useActiveConversation('target', [], loaded, true),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(result.current?.id).toBe('target'));

    // Список увидел дописанную строку — гейт закрылся.
    loaded = [conv('target')];
    rerender();
    // Рефеч списка снова потерял строку: без терминальности гейт false→true
    // запустил бы повторный скан страниц.
    client.setQueryData(chatKeys.conversations(), page([conv('a')], 'c1'));
    loaded = [];
    rerender();

    await waitFor(() => expect(result.current?.id).toBe('target'));
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
  });

  it('смена id без ремаунта запускает поиск заново', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(page([conv('target')], null))
      .mockResolvedValueOnce(page([conv('other')], null));
    let id = 'target';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(() => useActiveConversation(id, [], [], true), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(result.current?.id).toBe('target'));

    id = 'other';
    rerender();
    await waitFor(() => expect(result.current?.id).toBe('other'));
    expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
  });

  it('после выпадения результата из кэша поиск повторяется', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(page([conv('target')], null))
      .mockResolvedValueOnce(page([conv('target')], null));
    const { result, client, rerender } = renderActive('target', [], []);
    await waitFor(() => expect(result.current?.id).toBe('target'));

    client.removeQueries({ queryKey: chatKeys.conversationLookup('target') });
    rerender();
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledTimes(2));
  });

  it('строка поиска возвращается в список после его рефеча', async () => {
    vi.mocked(api).mockResolvedValueOnce(page([conv('target')], null));
    let loaded: ConversationListItem[] = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(
      () => useActiveConversation('target', [], loaded, true),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(result.current?.id).toBe('target'));

    // Список перезапросился и потерял дописанную строку.
    client.setQueryData(chatKeys.conversations(), page([conv('a')], 'c1'));
    loaded = [];
    rerender();

    await waitFor(() => {
      const list = client.getQueryData<Paginated<ConversationListItem>>(chatKeys.conversations());
      expect(list?.items.map((c) => c.id)).toContain('target');
    });
  });
});
