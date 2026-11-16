import { describe, expect, it } from 'vitest';

import { messageSchema } from '../chat/chat.schemas.js';
import { conversationListItemSchema } from '../chat/chat.schemas.js';
import { userListItemSchema } from '../directory/user.schemas.js';
import { userRefSchema } from '../directory/user-ref.schema.js';
import { chatMessageSentPayloadSchema } from './chat-events.js';

/** Регресс #880: аватар — файл-дериват, API отдаёт ОТНОСИТЕЛЬНЫЙ подписанный
 * путь (`/api/v1/files/<id>/content?exp=&sig=`). Прежний `z.url()` требовал
 * абсолютный URL и отбрасывал живые payload с аватаром → десктопные попапы
 * чата не приходили от авторов с аватаром (81% живых событий). Канон подписных
 * ссылок — строка (как у вложений). */
const SIGNED_AVATAR =
  '/api/v1/files/33333333-3333-4333-8333-333333333333/content?exp=1760000000&sig=abc';
const USER = '11111111-1111-4111-8111-111111111111';
const CONV = '22222222-2222-4222-8222-222222222222';
const MSG = '44444444-4444-4444-8444-444444444444';

const ref = (avatarUrl: string | null) => ({ id: USER, displayName: 'Иван Петров', avatarUrl });

function message(avatarUrl: string | null) {
  return {
    id: MSG,
    conversationId: CONV,
    seq: 7,
    clientMessageId: 'client-1',
    author: ref(avatarUrl),
    text: 'Привет',
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
    createdAt: '2026-11-16T10:00:00.000Z',
  };
}

function sentPayload(avatarUrl: string | null) {
  return {
    conversationId: CONV,
    messageId: MSG,
    seq: 7,
    authorId: USER,
    threadRootId: null,
    forwarded: false,
    urgent: false,
    mentionedUserIds: [],
    message: message(avatarUrl),
  };
}

describe('avatarUrl: относительный подписанный путь (#880)', () => {
  it('userRefSchema принимает относительный подписанный путь и null', () => {
    expect(userRefSchema.safeParse(ref(SIGNED_AVATAR)).success).toBe(true);
    expect(userRefSchema.safeParse(ref(null)).success).toBe(true);
  });

  it('messageSchema принимает автора с относительным аватаром', () => {
    expect(messageSchema.safeParse(message(SIGNED_AVATAR)).success).toBe(true);
  });

  it('chatMessageSentPayloadSchema проходит с аватаром автора (живой попап чата)', () => {
    const parsed = chatMessageSentPayloadSchema.safeParse(sentPayload(SIGNED_AVATAR));
    expect(parsed.success).toBe(true);
  });

  it('chatMessageSentPayloadSchema проходит с аватаром автора цитаты', () => {
    const payload = sentPayload(null);
    payload.message.reply = {
      id: MSG,
      author: ref(SIGNED_AVATAR),
      text: 'оригинал',
      quoteText: null,
      attachmentKind: null,
      deleted: false,
      obliterated: false,
    };
    payload.message.replyToId = MSG;
    expect(chatMessageSentPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('список бесед и список сотрудников принимают относительный аватар', () => {
    expect(conversationListItemSchema.shape.avatarUrl.safeParse(SIGNED_AVATAR).success).toBe(true);
    expect(userListItemSchema.shape.avatarUrl.safeParse(SIGNED_AVATAR)).toMatchObject({
      success: true,
    });
  });
});
