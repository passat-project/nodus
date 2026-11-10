// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Paginated } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';
import { useThreadMessages } from './chat-queries.js';
import { api } from '../api-client.js';

vi.mock('../api-client.js', () => ({ api: vi.fn() }));

/**
 * Открытие окна трэда всегда сверяется с сервером (#303): WS-событие о
 * ответе могло не дойти (разрыв сокета, гонка conv:join) — кэш окна моложе
 * staleTime никто не пометит протухшим, и до фикса повторное открытие в
 * течение 30 с показывало старый снимок («зашёл — сообщения нет, F5 —
 * есть»). refetchOnMount: 'always' закрывает класс: монтирование окна =
 * фоновая сверка, кэш рисуется мгновенно.
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const ROOT = '22222222-2222-4222-8222-222222222222';

const msg = (id: string, seq: number): ChatMessage => ({
  id,
  conversationId: CONV,
  seq,
  clientMessageId: id,
  author: { id: 'u1', displayName: 'Автор', avatarUrl: null },
  text: `текст ${id}`,
  replyToId: null,
  reply: null,
  threadRootId: id === ROOT ? null : ROOT,
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
  createdAt: '2026-10-16T10:00:00Z',
});

const page = (items: ChatMessage[]): Paginated<ChatMessage> => ({ items, nextCursor: null });

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe('useThreadMessages: открытие окна всегда сверяется с сервером (#303)', () => {
  afterEach(() => {
    vi.mocked(api).mockReset();
  });

  it('СВЕЖИЙ кэш окна (моложе staleTime) пересматривается при монтировании', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
    // «Старый» снимок в кэше: только корень, без нового ответа r2; запись
    // только что — по staleTime кэш «свеж», refetchOnMount по умолчанию молчал бы.
    client.setQueryData(chatKeys.thread(CONV, ROOT), page([msg(ROOT, 1)]));
    vi.mocked(api).mockResolvedValue(page([msg(ROOT, 1), msg('r2', 2)]));

    const { result } = renderHook(() => useThreadMessages(CONV, ROOT), {
      wrapper: wrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data?.items.map((m) => m.id)).toEqual([ROOT, 'r2']);
    });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('повторное открытие (размонтирование → монтаж) снова сверяется', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
    client.setQueryData(chatKeys.thread(CONV, ROOT), page([msg(ROOT, 1)]));
    vi.mocked(api).mockResolvedValue(page([msg(ROOT, 1), msg('r2', 2)]));

    const first = renderHook(() => useThreadMessages(CONV, ROOT), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(first.result.current.data?.items).toHaveLength(2));
    first.unmount();

    const second = renderHook(() => useThreadMessages(CONV, ROOT), {
      wrapper: wrapper(client),
    });
    await waitFor(() => {
      expect(second.result.current.data?.items).toHaveLength(2);
    });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    second.unmount();
  });
});
