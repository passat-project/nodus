// Модераторское удаление (#245): админ беседы и глобальный модератор портала
// (chat.moderate) удаляют чужие сообщения в группах/каналах; участник — только
// свои; надгробие/бесследность — общий канон #163; чужое — детальная аудит-запись.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { MessagesDeleteService } from './messages-delete.service.js';
import type { MemberRow } from '../conversations/conversations.repository.js';
import type { MessageRow } from './message-row.js';

const CONV = 'conv-1';
const ME = 'me-1';
const PEER = 'peer-1';
const TX = 'tx-handle';

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  const now = new Date('2026-10-07T09:00:00Z');
  return {
    id: 'msg-1',
    conversationId: CONV,
    seq: 3n,
    authorId: PEER,
    clientMessageId: 'key-1',
    text: 'Чужое сообщение',
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
    role: 'member',
    lastReadSeq: 0n,
    lastReadAt: null,
    lastFeedReadSeq: 0n,
    lastFeedReadAt: null,
    joinedAt: new Date('2026-10-07T09:00:00Z'),
    pinned: false,
    muted: false,
    snoozed: false,
    hidden: false,
    ...overrides,
  };
}

describe('MessagesDeleteService: модерация (#245)', () => {
  const repo = {
    findByIdInConversation: vi.fn(),
    tombstone: vi.fn(),
    hasLiveReplies: vi.fn(),
    deletePinByMessage: vi.fn(),
    markRepliesDeleted: vi.fn(),
    obliterateTombstone: vi.fn(),
  };
  const conversations = {
    findMembership: vi.fn(),
    findTypeAndPermissions: vi.fn(),
    isNotesConversation: vi.fn(),
    listMembers: vi.fn(),
  };
  const auditRepo = { append: vi.fn(async () => undefined) };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const vault = {
    applyMessageSent: vi.fn(async () => {}),
    applyMessageEdited: vi.fn(async () => {}),
    applyMessageDeleted: vi.fn(async () => {}),
    applyForwardCopies: vi.fn(async () => {}),
  };
  let service: MessagesDeleteService;

  beforeEach(() => {
    vi.clearAllMocks();
    conversations.findMembership.mockResolvedValue(makeMember());
    conversations.findTypeAndPermissions.mockResolvedValue({ id: CONV, type: 'group' });
    conversations.isNotesConversation.mockResolvedValue(false);
    conversations.listMembers.mockResolvedValue([]);
    repo.findByIdInConversation.mockResolvedValue(makeMessage());
    repo.hasLiveReplies.mockResolvedValue(false);
    repo.tombstone.mockImplementation(async (_c: string, id: string, obliterated: boolean) =>
      makeMessage({ id, obliterated, deletedAt: new Date('2026-10-07T10:00:00Z') }),
    );
    service = new MessagesDeleteService(
      repo as never,
      repo as never, // жизненный цикл (MessagesLifecycleRepository, I5)
      conversations as never,
      txRunner as never,
      eventBus as never,
      { deleteByMessage: vi.fn().mockResolvedValue([]) } as never,
      vault as never,
      auditRepo as never,
    );
  });

  it('админ беседы удаляет чужое в группе: след по #163 + moderated + аудит', async () => {
    conversations.findMembership.mockResolvedValue(makeMember({ role: 'admin' }));
    repo.hasLiveReplies.mockResolvedValue(true); // надгробие, как у автора

    const result = await service.delete(ME, CONV, 'msg-1');

    expect(result.obliterated).toBe(false);
    expect(result.moderated).toBe(true);
    expect(repo.tombstone).toHaveBeenCalledWith(CONV, 'msg-1', false, TX);
    expect(auditRepo.append).toHaveBeenCalledWith({
      actorId: ME,
      action: 'chat.message_moderated_delete',
      entityType: 'message',
      entityId: 'msg-1',
      details: { conversationId: CONV, authorId: PEER, obliterated: false },
    });
  });

  it('участник с chat.moderate (модератор портала) — то же в канале', async () => {
    conversations.findTypeAndPermissions.mockResolvedValue({ id: CONV, type: 'project_channel' });

    const result = await service.delete(ME, CONV, 'msg-1', ['chat.moderate']);

    expect(result.moderated).toBe(true);
    expect(repo.tombstone).toHaveBeenCalledWith(CONV, 'msg-1', true, TX);
    expect(auditRepo.append).toHaveBeenCalledTimes(1);
  });

  it('обычный участник — чужое FORBIDDEN, следа и аудита нет', async () => {
    await expect(service.delete(ME, CONV, 'msg-1', [])).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Only author can modify this message',
    });
    expect(repo.tombstone).not.toHaveBeenCalled();
    expect(auditRepo.append).not.toHaveBeenCalled();
  });

  it('модератору запрещено вне групп/каналов (direct/задачи/письма)', async () => {
    conversations.findTypeAndPermissions.mockResolvedValue({ id: CONV, type: 'direct' });

    await expect(service.delete(ME, CONV, 'msg-1', ['chat.moderate'])).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(repo.tombstone).not.toHaveBeenCalled();
  });

  it('своё сообщение — без пометки модерации и без доп. аудита', async () => {
    repo.findByIdInConversation.mockResolvedValue(makeMessage({ authorId: ME }));

    const result = await service.delete(ME, CONV, 'msg-1', []);

    expect(result.moderated).toBe(false);
    expect(auditRepo.append).not.toHaveBeenCalled();
  });

  it('модератор-НЕ-участник беседы — NOT_FOUND (модель видимости: членство обязательное)', async () => {
    // Security-ревью #245: удаление следует модели чтения (лента только для
    // участников) — модератор без членства НЕ удаляет невидимое ему.
    conversations.findMembership.mockResolvedValue(null);

    await expect(service.delete(ME, CONV, 'msg-1', ['chat.moderate'])).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'Conversation not found',
    });
    expect(repo.tombstone).not.toHaveBeenCalled();
    expect(auditRepo.append).not.toHaveBeenCalled();
  });

  it('batch: модератор удаляет и свои, и чужие; участнику чужие пропускаются', async () => {
    const byId: Record<string, MessageRow> = {
      own: makeMessage({ id: 'own', authorId: ME, seq: 10n }),
      foreign: makeMessage({ id: 'foreign', seq: 11n }),
    };
    repo.findByIdInConversation.mockImplementation(async (_c, id) => byId[id] ?? null);

    const moderator = await service.batchDelete(ME, CONV, ['own', 'foreign'], ['chat.moderate']);
    expect(moderator.removed).toEqual(['own', 'foreign']);
    expect(auditRepo.append).toHaveBeenCalledTimes(1); // только чужое

    vi.clearAllMocks();
    const member = await service.batchDelete(ME, CONV, ['own', 'foreign'], []);
    expect(member.removed).toEqual(['own']);
    expect(auditRepo.append).not.toHaveBeenCalled();
  });
});
