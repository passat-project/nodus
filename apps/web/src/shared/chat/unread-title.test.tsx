// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { chatKeys } from './chat-keys.js';
import { applyReadToCache } from './use-viewport-read.js';
import { useUnreadTitle } from './unread-title.js';

/**
 * ЦЕПОЧКА бейджа (#254, #409): title считается из ТОЧНОЙ сводки
 * непрочитанных (не первой страницы списка); квитанция прочтения обязана
 * уменьшить сводку немедленно — даже если следующий сетевой рефеч (гонка с
 * коммитом read) вернул СТАРОЕ число.
 */

const CONV = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';

function withClient(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('цепочка бейджа непрочитанных', () => {
  it('квитанция гасит сводку; title обновляется из неё', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = {
      items: [
        { id: CONV, type: 'direct', unreadCount: 3, snoozed: false },
        { id: OTHER, type: 'direct', unreadCount: 0, snoozed: false },
      ],
    };
    qc.setQueryData(chatKeys.conversations(), list);
    qc.setQueryData(chatKeys.unreadSummary(), { chats: 3, entities: 0, total: 3 });

    const { result } = renderHook(() => useUnreadTitle(), { wrapper: withClient(qc) });
    await waitFor(() => expect(document.title).toBe('(3) Nodus'));

    await act(async () => {
      applyReadToCache(qc, CONV);
      // Гонка: фоновый рефеч принёс старые данные (и список, и сводку) —
      // патч квитанции обязан снова погасить счётчики.
      qc.setQueryData(chatKeys.conversations(), list);
      qc.setQueryData(chatKeys.unreadSummary(), { chats: 3, entities: 0, total: 3 });
      applyReadToCache(qc, CONV);
    });
    await waitFor(() => expect(result.current).toBeUndefined());
    await waitFor(() => expect(document.title).toBe('Nodus'));
  });

  it('applyReadToCache зануляет только прочитанную беседу и её вкладку', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatKeys.conversations(), {
      items: [
        { id: CONV, type: 'direct', unreadCount: 4, snoozed: false },
        { id: OTHER, type: 'task', unreadCount: 2, snoozed: false },
      ],
    });
    qc.setQueryData(chatKeys.unreadSummary(), { chats: 4, entities: 2, total: 6 });

    applyReadToCache(qc, CONV);

    expect(
      qc.getQueryData<{ items: { id: string; unreadCount: number }[] }>(chatKeys.conversations())
        ?.items,
    ).toEqual([
      { id: CONV, type: 'direct', unreadCount: 0, snoozed: false },
      { id: OTHER, type: 'task', unreadCount: 2, snoozed: false },
    ]);
    expect(qc.getQueryData(chatKeys.unreadSummary())).toEqual({
      chats: 0,
      entities: 2,
      total: 2,
    });
  });

  it('snoozed-беседа не вычитается из сводки (её там не было)', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatKeys.conversations(), {
      items: [{ id: CONV, type: 'direct', unreadCount: 4, snoozed: true }],
    });
    qc.setQueryData(chatKeys.unreadSummary(), { chats: 0, entities: 0, total: 0 });

    applyReadToCache(qc, CONV);

    expect(qc.getQueryData(chatKeys.unreadSummary())).toEqual({ chats: 0, entities: 0, total: 0 });
  });

  it('applyReadToCache двигает myLastReadSeq на upToSeq и только вперёд (#845)', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = () => ({
      items: [
        { id: CONV, type: 'direct', unreadCount: 2, snoozed: false, myLastReadSeq: 10 },
        { id: OTHER, type: 'task', unreadCount: 1, snoozed: false, myLastReadSeq: 4 },
      ],
    });
    qc.setQueryData(chatKeys.conversations(), list());

    applyReadToCache(qc, CONV, 12);
    expect(
      qc.getQueryData<{ items: { id: string; unreadCount: number; myLastReadSeq: number }[] }>(
        chatKeys.conversations(),
      )?.items,
    ).toEqual([
      { id: CONV, type: 'direct', unreadCount: 0, snoozed: false, myLastReadSeq: 12 },
      { id: OTHER, type: 'task', unreadCount: 1, snoozed: false, myLastReadSeq: 4 },
    ]);

    // Квитанция «назад» (видимое окно выше прежнего знака) не откатывает.
    applyReadToCache(qc, CONV, 9);
    expect(
      qc.getQueryData<{ items: { id: string; myLastReadSeq: number }[] }>(chatKeys.conversations())
        ?.items[0]?.myLastReadSeq,
    ).toBe(12);
  });
});
