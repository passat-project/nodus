import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatMessage, ConversationListItem, UserRef } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { chatKeys } from './chat-keys.js';
import { applyReadEvent } from './ws-apply.js';

/** Локальный патч списка бесед после chat.message_read (#799): галка
 *  «прочитано» у СВОЕГО последнего сообщения — без рефетча списка (#123). */

const CONV = 'conv-1';
const ME = '00000000-0000-4000-8000-000000000001';
const READER = '00000000-0000-4000-8000-000000000002';
const ME_REF: UserRef = { id: ME, displayName: 'Я', avatarUrl: null };
const READER_REF: UserRef = { id: READER, displayName: 'Читатель', avatarUrl: null };
const READ_AT = '2026-11-12T10:05:00Z';

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
  createdAt: '2026-11-12T10:00:00Z',
  ...overrides,
});

function conversation(lastMessage: ChatMessage | null): ConversationListItem {
  return {
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
    lastMessage,
    lastActivityAt: lastMessage?.createdAt ?? null,
    unreadCount: 0,
    myLastReadSeq: 0,
    pinned: false,
    muted: false,
    snoozed: false,
  };
}

function seedList(client: QueryClient, lastMessage: ChatMessage | null): void {
  client.setQueryData(chatKeys.conversations(), {
    items: [conversation(lastMessage)],
    nextCursor: null,
  });
}

function listLast(client: QueryClient): ChatMessage | null | undefined {
  return client.getQueryData<{ items: ConversationListItem[] }>(chatKeys.conversations())?.items[0]
    ?.lastMessage;
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: ME, displayName: 'Я', email: 'me@nodus.by', permissions: [] },
  });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe('applyReadEvent — галки в списке бесед (#799)', () => {
  it('чужое прочтение патчит readAt моего последнего сообщения в списке и scoped-вкладках', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const myLast = msg({ author: ME_REF, seq: 5 });
    seedList(client, myLast);
    client.setQueryData(chatKeys.scoped('chats'), {
      pages: [{ items: [conversation(myLast)], nextCursor: null }],
      pageParams: [null],
    });
    client.setQueryData(chatKeys.messages(CONV), { items: [myLast], nextCursor: null });

    const applied = applyReadEvent(client, {
      conversationId: CONV,
      userId: READER,
      upToSeq: 5,
      readAt: READ_AT,
    });

    expect(applied).toBe(true);
    expect(listLast(client)?.readAt).toBe(READ_AT);
    const scoped = client.getQueryData<{ pages: { items: ConversationListItem[] }[] }>(
      chatKeys.scoped('chats'),
    );
    expect(scoped?.pages[0]?.items[0]?.lastMessage?.readAt).toBe(READ_AT);
  });

  it('чужое последнее сообщение в списке не патчится', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedList(client, msg({ author: READER_REF, seq: 5 }));
    applyReadEvent(client, {
      conversationId: CONV,
      userId: READER,
      upToSeq: 5,
      readAt: READ_AT,
    });
    expect(listLast(client)?.readAt).toBeNull();
  });

  it('seq последнего сообщения больше upToSeq — не патчится', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedList(client, msg({ author: ME_REF, seq: 9 }));
    applyReadEvent(client, {
      conversationId: CONV,
      userId: READER,
      upToSeq: 5,
      readAt: READ_AT,
    });
    expect(listLast(client)?.readAt).toBeNull();
  });

  it('уже прочитанное последнее сообщение не перезаписывается (readAt — первый читавший)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedList(client, msg({ author: ME_REF, seq: 5, readAt: '2026-11-12T10:00:00Z' }));
    applyReadEvent(client, {
      conversationId: CONV,
      userId: READER,
      upToSeq: 5,
      readAt: READ_AT,
    });
    expect(listLast(client)?.readAt).toBe('2026-11-12T10:00:00Z');
  });

  it('удалённое последнее сообщение не патчится', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedList(client, msg({ author: ME_REF, seq: 5, deletedAt: '2026-11-12T10:06:00Z' }));
    applyReadEvent(client, {
      conversationId: CONV,
      userId: READER,
      upToSeq: 5,
      readAt: READ_AT,
    });
    expect(listLast(client)?.readAt).toBeNull();
  });

  it('своё прочтение список не трогает', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedList(client, msg({ author: ME_REF, seq: 5 }));
    applyReadEvent(client, {
      conversationId: CONV,
      userId: ME,
      upToSeq: 5,
      readAt: READ_AT,
    });
    expect(listLast(client)?.readAt).toBeNull();
  });
});
