import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationListItem } from '@nodus/contracts';

import { demoConversations, demoMessages } from '../../../../shared/mocks/data/chat.js';
import { applyReadReceipt } from './chat-mock-state.js';

/** #1026/#1032: мок-квитанция повторяет серверную модель областей — лента
 *  (`last_feed_read_seq`) и ответы треда (`thread_reads`) не пересекаются. */
const CONV = 'mock-read-scope-conv';
const ROOT = 'mock-read-scope-root';
const AUTHOR = { id: 'mock-read-scope-author', displayName: 'Автор', avatarUrl: null };
const READER = { id: 'mock-read-scope-reader', displayName: 'Читатель', avatarUrl: null };

const message = (id: string, seq: number, threadRootId: string | null): ChatMessage =>
  ({
    id,
    conversationId: CONV,
    seq,
    clientMessageId: `client-${id}`,
    author: AUTHOR,
    text: id,
    replyToId: null,
    reply: null,
    threadRootId,
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
    createdAt: '2026-11-25T10:00:00Z',
  }) as never;

const conversation = (): ConversationListItem =>
  ({
    id: CONV,
    type: 'group',
    title: 'Мок-беседа',
    avatarUrl: null,
    myRole: 'member',
    permissions: {},
    draft: null,
    visibility: null,
    description: null,
    project: null,
    task: null,
    letter: null,
    membersPreview: [AUTHOR, READER],
    membersCount: 2,
    lastMessage: null,
    lastActivityAt: null,
    unreadCount: 3,
    myLastReadSeq: 0,
    pinned: false,
    muted: false,
    snoozed: false,
  }) as never;

const feedPost = () => message('post', 5, null);
const threadReply = () => message('reply', 9, ROOT);

afterEach(() => {
  const index = demoConversations.findIndex((c) => c.id === CONV);
  if (index >= 0) demoConversations.splice(index, 1);
  for (const id of ['post', 'reply']) {
    const messageIndex = demoMessages.findIndex((m) => m.id === id);
    if (messageIndex >= 0) demoMessages.splice(messageIndex, 1);
  }
});

function seed() {
  const post = feedPost();
  const reply = threadReply();
  demoConversations.push(conversation());
  demoMessages.push(post, reply);
  return { post, reply };
}

describe('applyReadReceipt: область квитанции (#1032)', () => {
  it('квитанция ленты не ставит просмотр ответу треда', () => {
    const { post, reply } = seed();
    expect(applyReadReceipt(CONV, 20, null)).toBe(20);
    expect(post.readBy).toHaveLength(1);
    expect(reply.readBy).toEqual([]);
  });

  it('квитанция треда не делает прочитанным пост ленты', () => {
    const { post, reply } = seed();
    applyReadReceipt(CONV, 20, ROOT);
    expect(reply.readBy.map((u) => u.id)).toEqual([READER.id]);
    expect(post.readBy).toEqual([]);
  });

  it('чужая область не патчится: другой тред остаётся непрочитанным', () => {
    const { post, reply } = seed();
    applyReadReceipt(CONV, 20, 'another-thread');
    expect(post.readBy).toEqual([]);
    expect(reply.readBy).toEqual([]);
  });
});
