import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { findFirstUnreadId } from './unread-divider.js';

/**
 * Граница «Непрочитанные сообщения» (#845): плашка встаёт ОДИН раз на
 * открытии над первым непрочитанным и живёт в ленте, пока открыт диалог
 * (модель Telegram `UnreadBar::freezed`). Живые watermark/`unreadCount` её
 * не двигают — иначе вставка/удаление строки дёргали бы ленту.
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

describe('findFirstUnreadId', () => {
  const items = [message(9), message(10), message(11), message(12), message(13)];

  it('первое сообщение после прочитанного знака', () => {
    expect(findFirstUnreadId(items, 10)).toBe('m-11');
  });

  it('знак неизвестен (список не дал данные) — границы нет', () => {
    expect(findFirstUnreadId(items, null)).toBeNull();
  });

  it('своё сообщение границей не бывает', () => {
    const own = [message(9), message(10), message(11, { authorId: ME }), message(12)];
    expect(findFirstUnreadId(own, 10, ME)).toBe('m-12');
  });

  it('только своё после знака — границы нет', () => {
    const onlyOwn = [message(9), message(10, { authorId: ME })];
    expect(findFirstUnreadId(onlyOwn, 9, ME)).toBeNull();
  });

  it('удалённое выше знака пропускается (без фильтра стало бы границей)', () => {
    const mixed = [message(9), message(11, { deletedAt: '2026-11-13T10:00:01.000Z' }), message(12)];
    expect(findFirstUnreadId(mixed, 10)).toBe('m-12');
  });

  it('темп отправки (seq = 0) границей не бывает', () => {
    const withTemp = [message(9), message(0), message(10)];
    expect(findFirstUnreadId(withTemp, 9)).toBe('m-10');
  });

  it('в ленте нет ничего после знака — границы нет', () => {
    expect(findFirstUnreadId(items, 13)).toBeNull();
  });
});
