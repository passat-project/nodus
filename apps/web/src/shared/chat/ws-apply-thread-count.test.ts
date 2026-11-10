import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatMessage } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';
import { applySentMessage } from './ws-apply.js';

/**
 * Счётчик ответов корневого поста (#303): одна отправка обязана тикать его
 * РОВНО на +1. До фикса считали трижды: оптимистичный +1 onMutate, +1 от
 * WS-эха (conv-комната) и +1 от дубля эха (user-комната, at-least-once
 * fanout gateway) — 3 → 6 → 9 → 12, F5 ставил серверную цифру. Сюда же —
 * защитная семантика окна трэда (pendingReplaced без темпа в окне).
 */

const CONV = 'conv-1';
const ROOT = 'root-1';

const msg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: CONV,
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'u1', displayName: 'Автор', avatarUrl: null },
  text: 'текст',
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
  createdAt: '2026-10-16T10:00:00Z',
  ...overrides,
});

function rootOf(client: QueryClient): ChatMessage | undefined {
  return client
    .getQueryData<{ items: ChatMessage[] }>(chatKeys.messages(CONV))
    ?.items.find((m) => m.id === ROOT);
}

describe('applySentMessage: счётчик ответов трэда (#303)', () => {
  it('дубль доставки (conv + user комната): счётчик корня растёт РОВНО на 1', () => {
    // Повтор события попадает в «уже применено» и не имеет права снова
    // тикать счётчик — иначе каждая отправка считалась дважды.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ id: ROOT, seq: 3, threadRepliesCount: 2 })],
      nextCursor: null,
    });
    const event = {
      conversationId: CONV,
      threadRootId: ROOT,
      message: msg({ id: 'r3', seq: 4, threadRootId: ROOT }),
    };
    expect(applySentMessage(client, event)).toBe(true);
    expect(applySentMessage(client, event)).toBe(true);
    expect(rootOf(client)?.threadRepliesCount).toBe(3); // не 4
  });

  it('своя отправка: темп только в окне треда — эхо считает +1 один раз', () => {
    // onMutate больше не тикает счётчик ленты (убран #303): темп реплая
    // живёт в кэше окна треда; эхо вставляет запись в ленту и +1, дубль эха
    // молчит — ровно +1 на отправку, как на сервере.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ id: ROOT, seq: 3, threadRepliesCount: 2 })],
      nextCursor: null,
    });
    client.setQueryData(chatKeys.thread(CONV, ROOT), {
      items: [
        msg({ id: ROOT, seq: 3 }),
        msg({ id: 'temp-9', seq: 0, clientMessageId: 'temp-9', threadRootId: ROOT }),
      ],
      nextCursor: null,
    });
    const event = {
      conversationId: CONV,
      threadRootId: ROOT,
      message: msg({
        id: 'server-9',
        seq: 4,
        clientMessageId: 'temp-9',
        threadRootId: ROOT,
      }),
    };
    expect(applySentMessage(client, event)).toBe(true);
    expect(applySentMessage(client, event)).toBe(true);
    const list = client.getQueryData<{ items: ChatMessage[] }>(chatKeys.messages(CONV));
    expect(list?.items.map((m) => m.id)).toEqual([ROOT, 'server-9']);
    expect(rootOf(client)?.threadRepliesCount).toBe(3); // +1, не +2 и не +3
    const thread = client.getQueryData<{ items: ChatMessage[] }>(chatKeys.thread(CONV, ROOT));
    expect(thread?.items.map((m) => m.id)).toEqual([ROOT, 'server-9']); // темп заменён
  });

  it('эхо темпа ленты в ОТКРЫТОМ окне без темпа → false (рефетч окна)', () => {
    // Защитный случай: темп жил в ленте, окно трэда его не видело —
    // подтвердить окно может только рефеч (инвалидация), не молчание.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [
        msg({ id: ROOT, seq: 3 }),
        msg({ id: 'temp-9', seq: 0, clientMessageId: 'temp-9', threadRootId: ROOT }),
      ],
      nextCursor: null,
    });
    client.setQueryData(chatKeys.thread(CONV, ROOT), {
      items: [msg({ id: ROOT, seq: 3 })],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: ROOT,
      message: msg({
        id: 'server-9',
        seq: 4,
        clientMessageId: 'temp-9',
        threadRootId: ROOT,
      }),
    });
    expect(applied).toBe(false); // вызывающий инвалидирует — окно догонит
  });
});
