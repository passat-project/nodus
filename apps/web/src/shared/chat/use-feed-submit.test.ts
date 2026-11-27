import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { replyDraftFrom } from './reply-snapshot.js';
import { feedSendVars, findLastMine } from './use-feed-submit.js';

/** ↑-правка последнего своего: живое, не пересланное, подтверждённое. */

const ME = 'me';
const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id,
    seq: 1,
    author: { id: ME, displayName: 'Я', avatarUrl: null },
    text: 'текст',
    deletedAt: null,
    forwardedFrom: null,
    attachments: [],
    ...over,
  }) as ChatMessage;

describe('findLastMine', () => {
  it('берёт последнее своё подтверждённое', () => {
    const items = [
      msg('a'),
      msg('b'),
      msg('c', { author: { id: 'x', displayName: 'X', avatarUrl: null } }),
    ];
    expect(findLastMine(items, ME)?.id).toBe('b');
  });

  it('пропускает летящий темп, удалённое и пересланное ЧУЖОЕ', () => {
    const items = [
      msg('ok'),
      msg('fwd', {
        forwardedFrom: {
          author: { id: 'x', displayName: 'X', avatarUrl: null },
          conversationId: 'conv-src',
          messageId: 'src-1',
          threadRootId: null,
        },
      }),
      msg('del', { deletedAt: '2026-10-07T10:00:00Z' }),
      msg('temp', { seq: 0 }),
    ];
    expect(findLastMine(items, ME)?.id).toBe('ok');
  });

  it('пересланное СВОЕГО текста — правится последним (#1072)', () => {
    const items = [
      msg('ok'),
      msg('fwd-own', {
        forwardedFrom: {
          author: { id: ME, displayName: 'Я', avatarUrl: null },
          conversationId: 'conv-src',
          messageId: 'src-1',
          threadRootId: null,
        },
      }),
    ];
    expect(findLastMine(items, ME)?.id).toBe('fwd-own');
  });

  it('без пользователя — ничего', () => {
    expect(findLastMine([msg('a')], undefined)).toBeUndefined();
  });
});

describe('feedSendVars: лента канала не отвечает цитатами (#1027)', () => {
  const submit = (reply = true) => ({
    text: 'текст',
    attachments: [],
    reply: reply ? replyDraftFrom(msg('orig'), 'кусок') : null,
    edit: null,
  });

  it('feed:* — reply снимается, threadRootId не появляется', () => {
    const vars = feedSendVars(submit(), null, 'feed:conv-1');
    expect(vars.replyToId).toBeNull();
    expect(vars.quoteText).toBeNull();
    expect(vars.reply).toBeNull();
    expect(vars.threadRootId).toBeUndefined();
  });

  it('обычная беседа — reply остаётся', () => {
    const vars = feedSendVars(submit(), null, 'conversation:conv-1');
    expect(vars.replyToId).toBe('orig');
    expect(vars.quoteText).toBe('кусок');
  });

  it('тред — reply остаётся и уходит с threadRootId', () => {
    const vars = feedSendVars(submit(), 'root-1', 'thread:root-1');
    expect(vars.replyToId).toBe('orig');
    expect(vars.threadRootId).toBe('root-1');
  });
});
