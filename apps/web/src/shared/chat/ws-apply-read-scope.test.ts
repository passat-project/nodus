// Область квитанции чтения (#1026): WS-событие ленты не ставит галку
// ответам треда и наоборот. Вынесено из `ws-apply.test.ts` (I5, ≤ 500 строк).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatMessage, ConversationListItem, UserRef } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';
import { useAuthStore } from '../auth-store.js';
import { applyReadEvent } from './ws-apply.js';

const CONV = 'conv-1';
const ROOT = 'root-1';
const ME = '00000000-0000-4000-8000-000000000001';
const READER = '00000000-0000-4000-8000-000000000002';
const READER_REF: UserRef = { id: READER, displayName: 'Читатель', avatarUrl: null };
const ME_REF: UserRef = { id: ME, displayName: 'Я', avatarUrl: null };

const msg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: CONV,
  seq: 1,
  clientMessageId: 'client-1',
  author: ME_REF,
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
  createdAt: '2026-09-25T10:00:00Z',
  ...overrides,
});

const conversation = (): ConversationListItem => ({
  id: CONV,
  type: 'group',
  title: 'беседа',
  avatarUrl: null,
  myRole: 'member',
  permissions: {
    changeInfo: 'owner',
    addMembers: 'owner',
    removeMembers: 'owner',
    post: 'member',
    manageSettings: 'owner',
  },
  draft: null,
  visibility: null,
  description: null,
  project: null,
  task: null,
  letter: null,
  membersPreview: [READER_REF],
  membersCount: 2,
  lastMessage: null,
  lastActivityAt: null,
  unreadCount: 0,
  myLastReadSeq: 0,
  pinned: false,
  muted: false,
  snoozed: false,
});

function seed(client: QueryClient, items: ChatMessage[]): void {
  client.setQueryData(chatKeys.conversations(), { items: [conversation()], nextCursor: null });
  client.setQueryData(chatKeys.messages(CONV), { items, nextCursor: null });
}

function items(client: QueryClient): ChatMessage[] {
  return client.getQueryData<{ items: ChatMessage[] }>(chatKeys.messages(CONV))?.items ?? [];
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: ME, displayName: 'Я', email: 'me@nodus.by', permissions: [] },
  });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe('applyReadEvent: область квитанции (#1026)', () => {
  it('квитанция треда не ставит галку посту ленты и другому треду', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client, [
      msg({ id: 'post', seq: 5 }),
      msg({ id: 'reply', seq: 9, threadRootId: ROOT }),
      msg({ id: 'other-thread', seq: 10, threadRootId: 'root-2' }),
    ]);

    const applied = applyReadEvent(client, {
      conversationId: CONV,
      userId: READER,
      upToSeq: 9,
      readAt: '2026-09-27T10:00:00Z',
      threadRootId: ROOT,
    });

    expect(applied).toBe(true);
    const [post, reply, other] = items(client);
    expect(post?.readBy).toEqual([]);
    expect(reply?.readBy.map((r) => r.id)).toEqual([READER]);
    expect(other?.readBy).toEqual([]);
  });

  it('квитанция ленты не ставит галку ответам тредов', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client, [msg({ id: 'post', seq: 5 }), msg({ id: 'reply', seq: 9, threadRootId: ROOT })]);

    applyReadEvent(client, {
      conversationId: CONV,
      userId: READER,
      upToSeq: 9,
      readAt: '2026-09-27T10:00:00Z',
      threadRootId: null,
    });

    const [post, reply] = items(client);
    expect(post?.readBy.map((r) => r.id)).toEqual([READER]);
    expect(reply?.readBy).toEqual([]);
  });
});
