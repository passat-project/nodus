import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { effectiveReadSeq, resolveFirstUnreadId } from './unread-divider.js';

/**
 * Граница «Непрочитанные сообщения» (#845): плашка считается по максимуму
 * серверного и ЛОКАЛЬНОГО водяных знаков прочтения. Главный регресс — список
 * бесед приходит с отставшим `myLastReadSeq`, и раньше плашка на мгновение
 * воскресала над уже прочитанными сообщениями, дёргая ленту.
 */

const ME = 'me';

function message(
  seq: number,
  overrides: Partial<ChatMessage> & { authorId?: string } = {},
): ChatMessage {
  const { authorId = 'other', ...rest } = overrides;
  return {
    id: `m-${seq}`,
    conversationId: 'conv-1',
    seq,
    clientMessageId: null,
    author: { id: authorId, displayName: authorId, avatarUrl: null },
    text: `сообщение ${seq}`,
    replyToId: null,
    reply: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [],
    editedAt: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: '2026-11-13T10:00:00.000Z',
    ...rest,
  } as ChatMessage;
}

const options = (overrides: Partial<Parameters<typeof resolveFirstUnreadId>[1]> = {}) => ({
  serverReadSeq: 10,
  localReadSeq: null,
  unreadCount: 3,
  meId: ME,
  ...overrides,
});

describe('effectiveReadSeq', () => {
  it('максимум двух знаков; null-ы нейтральны', () => {
    expect(effectiveReadSeq(10, null)).toBe(10);
    expect(effectiveReadSeq(null, 12)).toBe(12);
    expect(effectiveReadSeq(10, 12)).toBe(12);
    expect(effectiveReadSeq(12, 10)).toBe(12);
    expect(effectiveReadSeq(null, null)).toBeNull();
  });
});

describe('resolveFirstUnreadId', () => {
  const items = [message(9), message(10), message(11), message(12), message(13)];

  it('первое сообщение после серверного знака', () => {
    expect(resolveFirstUnreadId(items, options())).toBe('m-11');
  });

  it('локальный знак впереди серверного — граница считается по нему', () => {
    expect(resolveFirstUnreadId(items, options({ localReadSeq: 12 }))).toBe('m-13');
  });

  it('локальный знак покрыл всё — плашки нет, даже если сервер отстал (#845)', () => {
    expect(resolveFirstUnreadId(items, options({ localReadSeq: 13 }))).toBeNull();
  });

  it('серверный знак впереди локального (другое устройство) — тоже максимум', () => {
    expect(resolveFirstUnreadId(items, options({ serverReadSeq: 11, localReadSeq: 5 }))).toBe(
      'm-12',
    );
  });

  it('unreadCount = 0 — плашки нет даже при отставших знаках', () => {
    expect(resolveFirstUnreadId(items, options({ unreadCount: 0, localReadSeq: null }))).toBeNull();
  });

  it('оба знака неизвестны — плашки нет', () => {
    expect(
      resolveFirstUnreadId(items, options({ serverReadSeq: null, localReadSeq: null })),
    ).toBeNull();
  });

  it('своё сообщение границей не бывает', () => {
    const own = [message(9), message(10), message(11, { authorId: ME }), message(12)];
    expect(resolveFirstUnreadId(own, options({ localReadSeq: 10 }))).toBe('m-12');
  });

  it('только своё после знака — плашки нет', () => {
    const onlyOwn = [message(9), message(10, { authorId: ME })];
    expect(
      resolveFirstUnreadId(onlyOwn, options({ localReadSeq: 9, serverReadSeq: 9 })),
    ).toBeNull();
  });

  it('удалённые и неотправленные (seq = 0) пропускаются', () => {
    const mixed = [
      message(9),
      message(10, { deletedAt: '2026-11-13T10:00:01.000Z' }),
      message(0),
      message(11),
    ];
    expect(resolveFirstUnreadId(mixed, options())).toBe('m-11');
  });

  it('в ленте нет ничего после знака — плашки нет', () => {
    expect(
      resolveFirstUnreadId(items, options({ serverReadSeq: 20, localReadSeq: 20 })),
    ).toBeNull();
  });
});
