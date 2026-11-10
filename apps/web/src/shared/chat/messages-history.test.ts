// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Paginated } from '@nodus/contracts';

import { api } from '../api-client.js';
import { chatKeys } from './chat-keys.js';
import type { HistoryPage } from './feed-merge.js';
import { ensureOlderPage, hasOlderMessages } from './messages-history.js';

vi.mock('../api-client.js', () => ({ api: vi.fn() }));

/**
 * Догрузка истории в плоский кэш (#307): страница старее границы преппен-
 * дится, курсор/маркер обновляются, повторный вызов в полёте — один запрос.
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const ROOT = '33333333-3333-4333-8333-333333333333';

const m = (id: string, seq: number): ChatMessage => ({
  id,
  conversationId: CONV,
  seq,
  clientMessageId: id,
  author: { id: 'u1', displayName: 'Автор', avatarUrl: null },
  text: `текст ${id}`,
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

describe('ensureOlderPage (#307)', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('преппендит страницу старее границы и обновляет курсор+маркер', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<HistoryPage>(chatKeys.messages(CONV), {
      items: [m('w1', 101), m('w2', 102)],
      nextCursor: 'cur-100',
    });
    vi.mocked(api).mockResolvedValue({
      items: [m('o1', 51), m('o2', 52)],
      nextCursor: 'cur-50',
    });

    await expect(ensureOlderPage(client, CONV)).resolves.toBe(true);

    expect(vi.mocked(api).mock.calls[0]?.[0]).toContain(`cursor=cur-100`);
    expect(vi.mocked(api).mock.calls[0]?.[0]).toContain(`limit=50`);
    const data = client.getQueryData<HistoryPage>(chatKeys.messages(CONV));
    expect(data?.items.map((x) => x.id)).toEqual(['o1', 'o2', 'w1', 'w2']);
    expect(data?.nextCursor).toBe('cur-50');
    expect(data?.oldestLoadedSeq).toBe(51);
  });

  it('тред грузит с threadRootId и кладёт в свой ключ', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<HistoryPage>(chatKeys.thread(CONV, ROOT), {
      items: [m('r1', 30)],
      nextCursor: 'cur-29',
    });
    vi.mocked(api).mockResolvedValue({ items: [m('r0', 10)], nextCursor: null });

    await expect(ensureOlderPage(client, CONV, ROOT)).resolves.toBe(true);

    expect(vi.mocked(api).mock.calls[0]?.[0]).toContain(`threadRootId=${ROOT}`);
    const data = client.getQueryData<HistoryPage>(chatKeys.thread(CONV, ROOT));
    expect(data?.items.map((x) => x.id)).toEqual(['r0', 'r1']);
    expect(data?.nextCursor).toBeNull();
  });

  it('исчерпание (nextCursor=null) и пустой кэш — false без запроса', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<HistoryPage>(chatKeys.messages(CONV), {
      items: [m('a', 1)],
      nextCursor: null,
    });
    await expect(ensureOlderPage(client, CONV)).resolves.toBe(false);
    await expect(ensureOlderPage(client, '00000000-0000-4000-8000-000000000000')).resolves.toBe(
      false,
    );
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });

  it('сетевой отказ — false, кэш не тронут; повтор позже сможет загрузить', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<HistoryPage>(chatKeys.messages(CONV), {
      items: [m('w1', 5)],
      nextCursor: 'cur-4',
    });
    vi.mocked(api).mockRejectedValue(new Error('offline'));

    await expect(ensureOlderPage(client, CONV)).resolves.toBe(false);
    expect(client.getQueryData<HistoryPage>(chatKeys.messages(CONV))?.items).toHaveLength(1);
  });

  it('параллельные вызовы одного ключа — один полёт (общий промис)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<HistoryPage>(chatKeys.messages(CONV), {
      items: [m('w1', 5)],
      nextCursor: 'cur-4',
    });
    let resolveApi!: (v: Paginated<ChatMessage>) => void;
    vi.mocked(api).mockReturnValue(
      new Promise((res) => {
        resolveApi = res;
      }),
    );

    const first = ensureOlderPage(client, CONV);
    const second = ensureOlderPage(client, CONV);
    resolveApi({ items: [m('o1', 1)], nextCursor: null });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
  });
});

describe('hasOlderMessages (#307)', () => {
  it('true при живой границе, false при исчерпании/пустом кэше', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(hasOlderMessages(client, CONV)).toBe(false);
    client.setQueryData<HistoryPage>(chatKeys.messages(CONV), {
      items: [m('a', 1)],
      nextCursor: 'cur',
    });
    expect(hasOlderMessages(client, CONV)).toBe(true);
    expect(hasOlderMessages(client, CONV, ROOT)).toBe(false);
  });
});
