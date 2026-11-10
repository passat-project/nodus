import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatMessage, UserRef } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';
import { useAuthStore } from '../auth-store.js';
import {
  applyAttachmentPreviewEvent,
  applyReadEvent,
  applyReactionEvent,
  applySentMessage,
} from './ws-apply.js';

/** Локальное применение chat.message_sent по seq (раунд 3, «буря рефечей»). */

const CONV = 'conv-1';
const ROOT = 'root-1';

const msg = (
  overrides: Partial<import('@nodus/contracts').ChatMessage> = {},
): import('@nodus/contracts').ChatMessage => ({
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
  createdAt: '2026-09-25T10:00:00Z',
  ...overrides,
});

function feed(client: QueryClient): ChatMessage[] {
  return client.getQueryData<{ items: ChatMessage[] }>(chatKeys.messages(CONV))?.items ?? [];
}

describe('applySentMessage', () => {
  it('непрерывный seq → дописывается в ленту БЕЗ рефеча (true)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ id: 'a', seq: 5 })],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: msg({ id: 'b', seq: 6 }),
    });
    expect(applied).toBe(true);
    expect(feed(client).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('дыра в seq → false (вызывающий инвалидирует)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ id: 'a', seq: 5 })],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: msg({ id: 'c', seq: 8 }),
    });
    expect(applied).toBe(false);
    expect(feed(client).map((m) => m.id)).toEqual(['a']);
  });

  it('сообщение уже в кэше (своя отправка мутацией) → true, без изменений', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ id: 'a', seq: 5 }), msg({ id: 'b', seq: 6 })],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: msg({ id: 'b', seq: 6 }),
    });
    expect(applied).toBe(true);
    expect(feed(client)).toHaveLength(2);
  });

  it('нет кэша ленты → false (беседа не открыта)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: msg({ seq: 1 }),
    });
    expect(applied).toBe(false);
  });

  it('чужой темп (seq=0) в хвосте, непрерывный seq → вставка ПЕРЕД темпом, true (#243)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ id: 'a', seq: 5 }), msg({ id: 'temp', seq: 0, clientMessageId: 'temp-1' })],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: msg({ id: 'b', seq: 6, clientMessageId: 'server-b' }),
    });
    expect(applied).toBe(true);
    // Подтверждённое сообщение — перед хвостом летящих темпов.
    expect(feed(client).map((m) => m.id)).toEqual(['a', 'b', 'temp']);
  });

  it('эхо СВОЕГО темпа по clientMessageId → замена на месте, true, без рефеча (#243)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [
        msg({ id: 'a', seq: 5 }),
        msg({ id: 'temp-1', seq: 0, clientMessageId: 'temp-1', text: 'привет' }),
        msg({ id: 'temp-2', seq: 0, clientMessageId: 'temp-2' }),
      ],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: msg({ id: 'server-1', seq: 6, clientMessageId: 'temp-1', text: 'привет' }),
    });
    expect(applied).toBe(true);
    // Позиция темпа не двигается: серверная запись встала на его место,
    // более поздний темп остался в хвосте.
    expect(feed(client).map((m) => m.id)).toEqual(['a', 'server-1', 'temp-2']);
    expect(feed(client)[1]?.seq).toBe(6);
  });

  it('эхо своего темпа при ДЫРЕ в seq → замена всё равно точна, true (#243)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ id: 'a', seq: 5 }), msg({ id: 'temp-1', seq: 0, clientMessageId: 'temp-1' })],
      nextCursor: null,
    });
    // seq=7 при последнем реальном 5 — дыра, но свой темп сводится точно.
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: msg({ id: 'server-1', seq: 7, clientMessageId: 'temp-1' }),
    });
    expect(applied).toBe(true);
    expect(feed(client).map((m) => m.id)).toEqual(['a', 'server-1']);
  });

  it('ЧУЖАЯ запись с clientMessageId темпа темп не забирает (ключ уникален в рамках автора)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [
        msg({ id: 'a', seq: 5 }),
        // Темп НАШ (author u1), но ключ совпал с чужой отправкой.
        msg({ id: 'temp-1', seq: 0, clientMessageId: 'shared-key', text: 'моё' }),
      ],
      nextCursor: null,
    });
    // Чужое сообщение (другой автор) с тем же ключом — непрерывности нет (дыра).
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: msg({
        id: 'foreign',
        seq: 8,
        clientMessageId: 'shared-key',
        author: { id: 'u2', displayName: 'Чужой', avatarUrl: null },
      }),
    });
    expect(applied).toBe(false); // дыра → рефеч; темп не тронут
    expect(feed(client).map((m) => m.id)).toEqual(['a', 'temp-1']);
  });

  it('дыра в seq при темпе в хвосте (чужом) → false (рефетч заменит)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ id: 'a', seq: 5 }), msg({ id: 'temp', seq: 0, clientMessageId: 'temp-1' })],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: msg({ id: 'c', seq: 8, clientMessageId: 'server-c' }),
    });
    expect(applied).toBe(false);
  });

  it('ответ треда: лента + кэш треда + счётчик корня', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [
        msg({ id: ROOT, seq: 3, threadRepliesCount: 2 }),
        msg({ id: 'r2', seq: 5, threadRootId: ROOT }),
      ],
      nextCursor: null,
    });
    client.setQueryData(chatKeys.thread(CONV, ROOT), {
      items: [msg({ id: ROOT, seq: 3 }), msg({ id: 'r2', seq: 5, threadRootId: ROOT })],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: ROOT,
      message: msg({ id: 'r3', seq: 6, threadRootId: ROOT }),
    });
    expect(applied).toBe(true);
    // Лента: ответ инлайн + счётчик корня вырос.
    const list = feed(client);
    expect(list.map((m) => m.id)).toEqual([ROOT, 'r2', 'r3']);
    expect(list[0]!.threadRepliesCount).toBe(3);
    // Кэш треда: ответ дописан.
    const thread = client.getQueryData<{ items: ChatMessage[] }>(chatKeys.thread(CONV, ROOT));
    expect(thread?.items.map((m) => m.id)).toEqual([ROOT, 'r2', 'r3']);
  });

  it('ответ треда без кэша треда: лента + счётчик корня (окно треда не открыто)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ id: ROOT, seq: 3, threadRepliesCount: 0 })],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: ROOT,
      message: msg({ id: 'r1', seq: 4, threadRootId: ROOT }),
    });
    expect(applied).toBe(true);
    const list = feed(client);
    expect(list.map((m) => m.id)).toEqual([ROOT, 'r1']);
    expect(list[0]!.threadRepliesCount).toBe(1);
  });

  it('лента применилась, но окно ОТКРЫТОГО треда с дырой → false (рефетч окна)', () => {
    // seq беседы общий: между ответами треда были чужие сообщения ленты —
    // в окне треда непрерывности нет, молчать нельзя (замечание валидатора).
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [
        msg({ id: ROOT, seq: 3 }),
        msg({ id: 'other-4', seq: 4 }),
        msg({ id: 'r2', seq: 5, threadRootId: ROOT }),
        msg({ id: 'other-6', seq: 6, threadRootId: 'other-root' }),
      ],
      nextCursor: null,
    });
    client.setQueryData(chatKeys.thread(CONV, ROOT), {
      items: [msg({ id: ROOT, seq: 3 }), msg({ id: 'r2', seq: 5, threadRootId: ROOT })],
      nextCursor: null,
    });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: ROOT,
      message: msg({ id: 'r3', seq: 7, threadRootId: ROOT }),
    });
    // Лента дописана (последующий рефеч безвреден), но окно треда само не
    // догонит — применением считать нельзя.
    expect(applied).toBe(false);
    expect(feed(client).map((m) => m.id)).toContain('r3');
    const thread = client.getQueryData<{ items: ChatMessage[] }>(chatKeys.thread(CONV, ROOT));
    expect(thread?.items.map((m) => m.id)).toEqual([ROOT, 'r2']); // ждёт рефеч
  });

  it('нет DTO в событии (старый издатель) → false', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), { items: [], nextCursor: null });
    const applied = applySentMessage(client, {
      conversationId: CONV,
      threadRootId: null,
      message: undefined,
    });
    expect(applied).toBe(false);
  });
});

describe('applyReactionEvent (#124)', () => {
  const READER = { id: 'u2', displayName: 'Читатель', avatarUrl: null };

  function seedConvWithReader(client: QueryClient) {
    client.setQueryData(chatKeys.conversations(), {
      items: [
        {
          id: CONV,
          type: 'group',
          title: 'б',
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
          membersPreview: [READER],
          lastMessage: null,
          unreadCount: 0,
          myLastReadSeq: 0,
          pinned: false,
          muted: false,
          snoozed: false,
        },
      ],
      nextCursor: null,
    });
  }

  it('added: чип патчится в ленте без рефеча (актор не я, users из кэша)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedConvWithReader(client);
    client.setQueryData(chatKeys.messages(CONV), { items: [msg()], nextCursor: null });
    const applied = applyReactionEvent(
      client,
      { conversationId: CONV, messageId: 'm1', emoji: '👍', userId: 'u2' },
      true,
    );
    expect(applied).toBe(true);
    expect(feed(client)[0]?.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false, users: [READER] },
    ]);
  });

  it('added-эхо актёра уже в users (беседа с собой) — дубль не растит count', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedConvWithReader(client);
    // В беседе с собой membersPreview = сам зритель (канон #186): WS-эхо
    // собственной реакции приносит reader == уже записанный актёр.
    const SELF = { id: 'u2', displayName: 'Читатель', avatarUrl: null };
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ reactions: [{ emoji: '👍', count: 1, mine: true, users: [SELF] }] })],
      nextCursor: null,
    });
    const applied = applyReactionEvent(
      client,
      { conversationId: CONV, messageId: 'm1', emoji: '👍', userId: 'u2' },
      true,
    );
    expect(applied).toBe(true);
    expect(feed(client)[0]?.reactions).toEqual([
      { emoji: '👍', count: 1, mine: true, users: [SELF] },
    ]);
  });

  it('removed: декремент; ноль убирает чип', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [msg({ reactions: [{ emoji: '👍', count: 1, mine: false, users: [READER] }] })],
      nextCursor: null,
    });
    const applied = applyReactionEvent(
      client,
      { conversationId: CONV, messageId: 'm1', emoji: '👍', userId: 'u2' },
      false,
    );
    expect(applied).toBe(true);
    expect(feed(client)[0]?.reactions).toEqual([]);
  });

  it('сообщения нет в кэше — false (вызывающий инвалидирует)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const applied = applyReactionEvent(
      client,
      { conversationId: CONV, messageId: 'm1', emoji: '👍', userId: 'u2' },
      true,
    );
    expect(applied).toBe(false);
  });
});

describe('applyReadEvent (#124)', () => {
  const ME = '00000000-0000-4000-8000-000000000001';
  const READER = '00000000-0000-4000-8000-000000000002';

  function seedConversations(client: QueryClient, members: UserRef[]) {
    client.setQueryData(chatKeys.conversations(), {
      items: [
        {
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
          membersPreview: members,
          lastMessage: null,
          unreadCount: 0,
          myLastReadSeq: 0,
          pinned: false,
          muted: false,
          snoozed: false,
        },
      ],
      nextCursor: null,
    });
  }

  beforeEach(() => {
    useAuthStore.setState({
      user: { id: ME, displayName: 'Я', email: 'me@nodus.by', permissions: [] },
    });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null });
  });

  it('чужое прочтение: readBy/readAt моих сообщений до upToSeq', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedConversations(client, [{ id: READER, displayName: 'Читатель', avatarUrl: null }]);
    client.setQueryData(chatKeys.messages(CONV), {
      items: [
        msg({ id: 'mine', author: { id: ME, displayName: 'Я', avatarUrl: null }, seq: 3 }),
        msg({ id: 'theirs', author: { id: READER, displayName: 'Ч', avatarUrl: null }, seq: 4 }),
      ],
      nextCursor: null,
    });
    const applied = applyReadEvent(client, {
      conversationId: CONV,
      userId: READER,
      upToSeq: 3,
      readAt: '2026-09-27T10:00:00Z',
    });
    expect(applied).toBe(true);
    const [mine, theirs] = feed(client);
    expect(mine?.readBy.map((r) => r.id)).toEqual([READER]);
    expect(mine?.readAt).toBe('2026-09-27T10:00:00Z');
    expect(theirs?.readBy).toEqual([]);
  });

  it('своё прочтение — true без патча (readBy себя не включает)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), { items: [msg()], nextCursor: null });
    const applied = applyReadEvent(client, {
      conversationId: CONV,
      userId: ME,
      upToSeq: 9,
      readAt: '2026-09-27T10:00:00Z',
    });
    expect(applied).toBe(true);
    expect(feed(client)[0]?.readBy).toEqual([]);
  });

  it('читателя нет в membersPreview — false (вызывающий инвалидирует)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedConversations(client, []);
    client.setQueryData(chatKeys.messages(CONV), { items: [msg()], nextCursor: null });
    const applied = applyReadEvent(client, {
      conversationId: CONV,
      userId: READER,
      upToSeq: 9,
      readAt: '2026-09-27T10:00:00Z',
    });
    expect(applied).toBe(false);
  });
});

describe('applyAttachmentPreviewEvent (#221)', () => {
  const att = (id: string, thumbnailUrl: string | null) =>
    ({
      id,
      fileId: `f-${id}`,
      name: `${id}.png`,
      size: 10,
      mime: 'image/png',
      kind: 'image',
      url: `/orig/${id}`,
      thumbnailUrl,
      previewKind: 'image',
      pdfUrl: null,
      width: 100,
      height: 50,
    }) as import('@nodus/contracts').MessageAttachment;

  it('патчит thumbnailUrl вложения на месте, без рефеча и чужих сообщений', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.messages(CONV), {
      items: [
        msg({ id: 'm1', attachments: [att('a1', null), att('a2', '/thumb/old')] }),
        msg({ id: 'm2', attachments: [att('a3', null)] }),
      ],
      nextCursor: null,
    });
    applyAttachmentPreviewEvent(client, {
      conversationId: CONV,
      attachmentId: 'a1',
      thumbnailUrl: '/thumb/new',
    });
    const items = feed(client);
    expect(items[0]!.attachments[0]!.thumbnailUrl).toBe('/thumb/new');
    expect(items[0]!.attachments[1]!.thumbnailUrl).toBe('/thumb/old'); // чужие не тронуты
    expect(items[1]!.attachments[0]!.thumbnailUrl).toBeNull();
    expect(client.getQueryData(chatKeys.messages(CONV))).toBeTruthy();
  });
});
