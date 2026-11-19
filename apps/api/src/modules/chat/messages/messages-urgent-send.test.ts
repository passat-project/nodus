import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type SendMessageBody } from '@nodus/contracts';

import { DEFAULT_CONVERSATION_PERMISSIONS } from '../permissions.js';
import { MessagesService } from './messages.service.js';
import type { MemberRow } from '../conversations/conversations.repository.js';
import type { MessageRow } from './message-row.js';

/** Отправка «важного сообщения» (#100): лимит отправителя (C5), потолок
 *  группы (C10, I8), direct-исключение, обход лимитов обычной отправкой. */

const CONV = 'conv-1';
const ME = 'me-1';
const ACTOR = { id: ME, permissions: [] as string[] };
const TX = 'tx-handle';
const FRESH_DTO = { id: 'msg-new' } as never;

function makeMember(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    conversationId: CONV,
    userId: 'peer-1',
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

function makeMessage(): MessageRow {
  const now = new Date('2026-10-01T00:00:00Z');
  return {
    id: 'msg-new',
    conversationId: CONV,
    seq: 7n,
    authorId: ME,
    clientMessageId: 'key-1',
    text: 'Текст',
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
  };
}

describe('MessagesService: send urgent (#100)', () => {
  const repo = {
    findExisting: vi.fn(),
    findByIdInConversation: vi.fn(),
    allocateSeqs: vi.fn(),
    insertMessage: vi.fn(),
    claimAttachments: vi.fn().mockResolvedValue([]),
    touchLastMessageAt: vi.fn(),
    countThreadReplies: vi.fn(),
    attachmentsFor: vi.fn(),
    updateEditText: vi.fn(),
    tombstone: vi.fn(),
    hasLiveReplies: vi.fn(),
    obliterateTombstone: vi.fn(),
    deletePinByMessage: vi.fn(),
    markRepliesDeleted: vi.fn(),
    advanceReadCursor: vi.fn(),
    countUrgentSentSince: vi.fn(),
    lockUrgentLimit: vi.fn(),
  };
  const conversations = {
    findMembership: vi.fn(),
    findTypeAndPermissions: vi.fn(),
    findLastSeq: vi.fn(),
    listMembers: vi.fn(),
    clearDraft: vi.fn(),
    unsnooze: vi.fn(),
    revealHidden: vi.fn(),
    countMembers: vi.fn(),
  };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const userProfiles = {
    findRefs: vi.fn(),
    searchByDisplayName: vi.fn(),
    findMentionMatches: vi.fn(),
  };
  const threadParticipants = {
    upsert: vi.fn(),
    delete: vi.fn(),
    findLastRead: vi.fn(),
    advanceReadCursor: vi.fn(),
    states: vi.fn(),
  };
  const stickersRepo = {
    findSticker: vi.fn(),
    findPackAccessible: vi.fn(),
    insertAttachmentForMessage: vi.fn(),
  };
  let service: MessagesService;

  const body = (urgent: boolean): SendMessageBody => ({ text: 'Срочно выйди на объект', urgent });

  beforeEach(() => {
    vi.clearAllMocks();
    conversations.findMembership.mockResolvedValue(makeMember({ userId: ME, role: 'owner' }));
    conversations.findTypeAndPermissions.mockResolvedValue({
      id: CONV,
      type: 'group',
      permissions: { ...DEFAULT_CONVERSATION_PERMISSIONS },
    });
    conversations.listMembers.mockResolvedValue([]);
    conversations.countMembers.mockResolvedValue(5);
    repo.findExisting.mockResolvedValue(null);
    repo.allocateSeqs.mockResolvedValue(7n);
    repo.insertMessage.mockResolvedValue(makeMessage());
    repo.countUrgentSentSince.mockResolvedValue(0);
    service = new MessagesService(
      repo as never,
      repo as never, // запись (MessagesWriteRepository)
      repo as never, // правка/удаление (MessagesLifecycleRepository)
      repo as never, // прочитанность (MessagesReadStateRepository)
      { syncMessageAttachments: vi.fn(), renameMessageAttachments: vi.fn() } as never,
      conversations as never,
      conversations as never, // запись участия (ConversationMembersRepository)
      conversations as never, // черновики (ConversationDraftsRepository)
      { toDtos: vi.fn(), toFreshDto: vi.fn().mockResolvedValue(FRESH_DTO) } as never,
      txRunner as never,
      eventBus as never,
      userProfiles as never,
      threadParticipants as never,
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

  it('C5: суточный лимит отправителя — четвёртая попытка отклонена, третья проходит', async () => {
    repo.countUrgentSentSince.mockResolvedValue(3);
    await expect(service.send(ACTOR, CONV, body(true), 'key-u4')).rejects.toMatchObject({
      code: ErrorCode.CHAT_URGENT_LIMIT_EXCEEDED,
    });
    repo.countUrgentSentSince.mockResolvedValue(2);
    await service.send(ACTOR, CONV, body(true), 'key-u3');
    expect(repo.insertMessage).toHaveBeenCalledWith(expect.objectContaining({ urgent: true }), TX);
  });

  it('#177: advisory-лок лимита автора берётся ДО подсчёта (анти-TOCTOU)', async () => {
    repo.countUrgentSentSince.mockResolvedValue(0);
    await service.send(ACTOR, CONV, body(true), 'key-lock');
    expect(repo.lockUrgentLimit).toHaveBeenCalledWith(ME, TX);
    const lockCall = repo.lockUrgentLimit.mock.invocationCallOrder[0]!;
    const countCall = repo.countUrgentSentSince.mock.invocationCallOrder[0]!;
    expect(lockCall).toBeLessThan(countCall);
  });

  it('C10: группа больше лимита участников — отклонено на бэкенде (I8)', async () => {
    conversations.countMembers.mockResolvedValue(21);
    await expect(service.send(ACTOR, CONV, body(true), 'key-g21')).rejects.toMatchObject({
      code: ErrorCode.CHAT_URGENT_GROUP_TOO_LARGE,
    });
  });

  it('direct — без проверки размера группы', async () => {
    conversations.findTypeAndPermissions.mockResolvedValue({
      id: CONV,
      type: 'direct',
      permissions: { ...DEFAULT_CONVERSATION_PERMISSIONS },
    });
    conversations.countMembers.mockResolvedValue(2);
    await service.send(ACTOR, CONV, body(true), 'key-d');
    expect(repo.insertMessage).toHaveBeenCalledWith(expect.objectContaining({ urgent: true }), TX);
    expect(conversations.countMembers).not.toHaveBeenCalled();
  });

  it('urgent=false — лимиты не проверяются', async () => {
    repo.countUrgentSentSince.mockResolvedValue(99);
    await service.send(ACTOR, CONV, body(false), 'key-n');
    expect(repo.insertMessage).toHaveBeenCalledWith(expect.objectContaining({ urgent: false }), TX);
    expect(repo.countUrgentSentSince).not.toHaveBeenCalled();
  });
});
