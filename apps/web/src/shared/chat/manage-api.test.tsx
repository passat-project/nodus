// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem, Paginated } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';
import { useRenameConversation } from './manage-api.js';

/**
 * Детерминированный тест оптимистичности переименования (канон I4 /
 * patterns.md, #186): новое название применено к кэшу списка бесед ДО
 * resolve ответа сервера (контролируемый deferred, без миллисекундных
 * ожиданий); reject → откат по снапшоту + тост.
 */

const CONV = '11111111-1111-4111-8111-111111111111';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const item = (title: string): ConversationListItem => ({
  id: CONV,
  type: 'group',
  title,
  avatarUrl: null,
  myRole: 'owner',
  permissions: {
    changeInfo: 'admin',
    addMembers: 'member',
    removeMembers: 'admin',
    post: 'member',
    manageSettings: 'owner',
  },
  draft: null,
  visibility: 'closed',
  description: null,
  project: null,
  task: null,
  letter: null,
  membersPreview: [],
  membersCount: 1,
  lastMessage: null,
  lastActivityAt: null,
  unreadCount: 0,
  myLastReadSeq: 0,
  pinned: false,
  muted: false,
  snoozed: false,
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client } satisfies QueryClientProviderProps,
      children,
    );
  };
}

function seededTitle(client: QueryClient): string | null {
  const page = client.getQueryData<Paginated<ConversationListItem>>(chatKeys.conversations());
  return page?.items[0]?.title ?? null;
}

afterEach(() => vi.unstubAllGlobals());

describe('useRenameConversation — оптимистичность', () => {
  it('название применяется к кэшу ДО ответа сервера; reject → откат', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.conversations(), { items: [item('Старое')], nextCursor: null });
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gate.promise),
    );

    const { result } = renderHook(() => useRenameConversation(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.mutate({ id: CONV, title: 'Новое' });
    });

    // До resolve: сервер молчит, кэш уже показывает новое название.
    await waitFor(() => expect(seededTitle(client)).toBe('Новое'));

    // Сервер отказал — откат к исходному названию (снапшот onMutate).
    gate.reject(new Error('network'));
    await waitFor(() => expect(seededTitle(client)).toBe('Старое'));
  });
});
