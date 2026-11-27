// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { ConversationListItem } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';
import { useConversationById } from './chat-queries.js';

/** #1062: тип беседы для вкладки — из загруженного списка или deep-link-поиска. */

const CONV = {
  id: '00000000-0000-4000-8000-0000000000c1',
  type: 'task',
} as ConversationListItem;

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function clientWithList(items: ConversationListItem[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(chatKeys.conversations(), { items, nextCursor: null });
  return client;
}

describe('useConversationById (#1062)', () => {
  it('беседа первой страницы списка: строка из списка, поиск не запускается', () => {
    const client = clientWithList([CONV]);
    const { result } = renderHook(() => useConversationById(CONV.id), {
      wrapper: wrapper(client),
    });
    expect(result.current).toEqual(CONV);
  });

  it('беседа за пределами первой страницы: тип из deep-link-поиска', () => {
    const client = clientWithList([]);
    client.setQueryData(chatKeys.conversationLookup(CONV.id), CONV);
    const { result } = renderHook(() => useConversationById(CONV.id), {
      wrapper: wrapper(client),
    });
    expect(result.current).toEqual(CONV);
  });
});
