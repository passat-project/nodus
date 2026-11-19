// Ветка stickerId отправки (#143): снапшот-вложение, доступ, keepDraft,
// монолитность. Отдельный файл от messages.service.test (I5: >500 строк).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type SendMessageBody } from '@nodus/contracts';

import { DEFAULT_CONVERSATION_PERMISSIONS } from '../permissions.js';
import { MessagesService } from './messages.service.js';
import type { MemberRow } from '../conversations/conversations.repository.js';
import type { MessageRow } from './message-row.js';

const CONV = 'conv-1';
const ME = 'me-1';
const ACTOR = { id: ME, permissions: [] as string[] };
const PEER = 'peer-1';
const TX = 'tx-handle';

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  const now = new Date('2026-09-24T09:00:00Z');
  return {
    id: 'msg-1',
    conversationId: CONV,
    seq: 3n,
    authorId: ME,
    clientMessageId: 'key-0',
    text: 'текст',
    kind: 'text',
    payload: null,
    replyToId: null,
    replySnapshot: null,
    threadRootId: null,
    fwdConversationId: null,
    fwdMessageId: null,
    fwdAuthorId: null,
    fwdThreadRootId: null,
    editedAt: null,
    deletedAt: null,
    obliterated: false,
    urgent: false,
    mentionedUserIds: null,
    everMentionedUserIds: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMember(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    conversationId: CONV,
    userId: ME,
    role: 'owner',
    lastReadSeq: 0n,
    lastReadAt: null,
    lastFeedReadSeq: 0n,
    lastFeedReadAt: null,
    joinedAt: new Date('2026-09-24T09:00:00Z'),
    pinned: false,
    muted: false,
    snoozed: false,
    hidden: false,
    ...overrides,
  };
}

describe('MessagesService.send: стикер (#143)', () => {
  let service: MessagesService;
  let repo: ReturnType<typeof makeRepo>;
  let conversations: ReturnType<typeof makeConversations>;
  let mapper: ReturnType<typeof makeMapper>;
  let stickersRepo: ReturnType<typeof makeStickersRepo>;

  function makeRepo() {
    return {
      findExisting: vi.fn().mockResolvedValue(null),
      findByIdInConversation: vi.fn().mockResolvedValue(null),
      allocateSeqs: vi.fn().mockResolvedValue(7n),
      insertMessage: vi.fn().mockResolvedValue(makeMessage({ id: 'msg-new', seq: 7n })),
      claimAttachments: vi.fn().mockResolvedValue([]),
      touchLastMessageAt: vi.fn(),
      attachmentsFor: vi.fn().mockResolvedValue([]),
    };
  }

  function makeConversations() {
    return {
      findMembership: vi.fn().mockResolvedValue(makeMember({ userId: ME, role: 'owner' })),
      findTypeAndPermissions: vi.fn().mockResolvedValue({
        id: CONV,
        type: 'group',
        permissions: { ...DEFAULT_CONVERSATION_PERMISSIONS },
      }),
      listMembers: vi.fn().mockResolvedValue([]),
      clearDraft: vi.fn(),
      unsnooze: vi.fn(),
      revealHidden: vi.fn(),
    };
  }

  function makeMapper() {
    return {
      toDtos: vi.fn(),
      toFreshDto: vi.fn().mockResolvedValue({ id: 'msg-new' }),
    };
  }

  function makeStickersRepo() {
    return {
      findSticker: vi.fn().mockResolvedValue(null),
      findPackAccessible: vi.fn().mockResolvedValue(null),
      insertAttachmentForMessage: vi.fn(),
    };
  }

  beforeEach(() => {
    repo = makeRepo();
    conversations = makeConversations();
    mapper = makeMapper();
    stickersRepo = makeStickersRepo();
    service = new MessagesService(
      repo as never,
      repo as never, // запись (MessagesWriteRepository)
      repo as never, // правка/удаление (MessagesLifecycleRepository)
      repo as never, // прочитанность (MessagesReadStateRepository)
      { syncMessageAttachments: vi.fn(), renameMessageAttachments: vi.fn() } as never,
      conversations as never,
      conversations as never, // запись участия (ConversationMembersRepository)
      conversations as never, // черновики (ConversationDraftsRepository)
      mapper as never,
      { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) } as never,
      { emit: vi.fn() } as never,
      { findRefs: vi.fn(), findMentionMatches: vi.fn().mockResolvedValue([]) } as never,
      { upsert: vi.fn(), advanceReadCursor: vi.fn(), states: vi.fn() } as never,
      { advance: vi.fn(), readCursorsFor: vi.fn() } as never,
      stickersRepo as never,
      {
        applyMessageSent: vi.fn(async () => {}),
        applyMessageEdited: vi.fn(async () => {}),
        applyMessageDeleted: vi.fn(async () => {}),
        applyForwardCopies: vi.fn(async () => {}),
      } as never,
      { enqueue: vi.fn(async () => undefined) } as never,
      { canPost: vi.fn(async () => true) } as never,
    );
  });

  it('вложение со снапшотом пака, черновик НЕ гасится, claim не зовётся', async () => {
    const body: SendMessageBody = { text: '', stickerId: 'st-1' };
    const hit = {
      id: 'st-1',
      packId: 'pack-1',
      fileId: 'file-1',
      emojis: ['🔥'],
      width: 512,
      height: 512,
      mime: 'image/png',
      size: 2048,
      sortOrder: 0,
      pack: {
        id: 'pack-1',
        title: 'Мемы',
        scope: 'personal',
        ownerId: ME,
        createdBy: ME,
        createdAt: new Date(),
      },
    };
    stickersRepo.findSticker.mockResolvedValue(hit);
    stickersRepo.findPackAccessible.mockResolvedValue({ id: 'pack-1' });
    stickersRepo.insertAttachmentForMessage.mockResolvedValue({
      id: 'att-st',
      fileId: 'file-1',
      ownerId: ME,
      name: 'sticker.png',
      size: 2048,
      mime: 'image/png',
      kind: 'sticker',
      width: 512,
      height: 512,
      thumbFileId: null,
      stickerMeta: { packId: 'pack-1', packTitle: 'Мемы', packScope: 'personal', emojis: ['🔥'] },
    });

    await service.send(ACTOR, CONV, body, 'key-st');

    expect(stickersRepo.insertAttachmentForMessage).toHaveBeenCalledWith(
      'msg-new',
      ME,
      hit,
      hit.pack,
      TX,
    );
    expect(repo.claimAttachments).not.toHaveBeenCalled();
    // keepDraft: набранный текст композера живёт дальше (#143).
    expect(conversations.clearDraft).not.toHaveBeenCalled();
    // Активность беседы — обычная (снуз/раскрытие/lastMessageAt).
    expect(conversations.unsnooze).toHaveBeenCalledWith(CONV, ME, TX);
    expect(mapper.toFreshDto).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg-new' }),
      expect.objectContaining({ attachments: [expect.objectContaining({ kind: 'sticker' })] }),
    );
  });

  it('стикер без доступа (не корпоративный, не свой, не установленный) → NOT_FOUND', async () => {
    stickersRepo.findSticker.mockResolvedValue({
      id: 'st-9',
      packId: 'pack-9',
      pack: { id: 'pack-9', ownerId: PEER, scope: 'personal' },
    });
    stickersRepo.findPackAccessible.mockResolvedValue(null);
    await expect(
      service.send(ACTOR, CONV, { text: '', stickerId: 'st-9' }, 'key-st2'),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });

  it('стикер + текст одновременно → VALIDATION_FAILED (монолитность модели Telegram)', async () => {
    await expect(
      service.send(ACTOR, CONV, { text: 'заодно', stickerId: 'st-1' }, 'key-st3'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(stickersRepo.findSticker).not.toHaveBeenCalled();
  });

  it('несуществующий стикер → NOT_FOUND до вставки сообщения', async () => {
    stickersRepo.findSticker.mockResolvedValue(null);
    await expect(
      service.send(ACTOR, CONV, { text: '', stickerId: 'st-404' }, 'key-st4'),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });
});
