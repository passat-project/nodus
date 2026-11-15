// >300 строк — обоснование (I5): полный контракт send/edit/delete/batch сервиса одного агрегата.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_EVENTS, ErrorCode, type SendMessageBody } from '@nodus/contracts';

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
    ...overrides,
  };
}

function makeMember(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    conversationId: CONV,
    userId: PEER,
    role: 'member',
    lastReadSeq: 0n,
    lastReadAt: null,
    joinedAt: new Date('2026-09-24T09:00:00Z'),
    pinned: false,
    muted: false,
    snoozed: false,
    hidden: false,
    ...overrides,
  };
}

/** Сентинел DTO свежего сообщения (payload события, раунд 3). */
const FRESH_DTO = { id: 'msg-new', sentinel: true } as never;

describe('MessagesService', () => {
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
    advanceReadCursor: vi.fn(),
    countUrgentSentSince: vi.fn(),
  };
  const attachmentsRepo = {
    syncMessageAttachments: vi.fn(),
    renameMessageAttachments: vi.fn(),
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
  const mapper = { toDtos: vi.fn(), toFreshDto: vi.fn() };
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
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const userProfiles = {
    findRefs: vi.fn(),
    searchByDisplayName: vi.fn(),
    findMentionMatches: vi.fn(),
  };
  let service: MessagesService;

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
    repo.countUrgentSentSince.mockResolvedValue(0);
    repo.findExisting.mockResolvedValue(null);
    mapper.toFreshDto.mockResolvedValue(FRESH_DTO);
    repo.findByIdInConversation.mockResolvedValue(null);
    repo.allocateSeqs.mockResolvedValue(7n);
    repo.insertMessage.mockResolvedValue(makeMessage({ id: 'msg-new', seq: 7n }));
    service = new MessagesService(
      repo as never,
      repo as never, // запись (MessagesWriteRepository)
      repo as never, // правка/удаление (MessagesLifecycleRepository)
      repo as never, // прочитанность (MessagesReadStateRepository)
      attachmentsRepo as never,
      conversations as never,
      conversations as never, // запись участия (ConversationMembersRepository)
      conversations as never, // черновики (ConversationDraftsRepository)
      mapper as never,
      txRunner as never,
      eventBus as never,
      userProfiles as never,
      threadParticipants as never,
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

  describe('send', () => {
    it('не член беседы → NOT_FOUND, до транзакции не доходит', async () => {
      conversations.findMembership.mockResolvedValue(null);
      await expect(service.send(ACTOR, CONV, { text: 'Привет' }, 'key-1')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: 'Conversation not found',
      });
      expect(repo.findExisting).not.toHaveBeenCalled();
    });

    it('replay того же ключа в этой беседе → replayed:true, БЕЗ side-effects', async () => {
      const existing = makeMessage({ id: 'msg-old', seq: 3n });
      repo.findExisting.mockResolvedValue(existing);

      const result = await service.send(ACTOR, CONV, { text: 'Повтор' }, 'key-1');

      expect(repo.findExisting).toHaveBeenCalledWith(ME, 'key-1', TX);
      expect(result).toMatchObject({ replayed: true, message: existing });
      expect(repo.insertMessage).not.toHaveBeenCalled();
      expect(repo.claimAttachments).not.toHaveBeenCalled();
      expect(repo.touchLastMessageAt).not.toHaveBeenCalled();
      expect(conversations.clearDraft).not.toHaveBeenCalled();
      expect(conversations.unsnooze).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('replay в ДРУГОЙ беседе → CONFLICT', async () => {
      repo.findExisting.mockResolvedValue(makeMessage({ conversationId: 'conv-other' }));
      await expect(service.send(ACTOR, CONV, { text: 'Повтор' }, 'key-1')).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: 'Idempotency-Key already used for another message',
      });
    });

    it('member при post=admin на корень ленты → FORBIDDEN; в тред — можно', async () => {
      conversations.findMembership.mockResolvedValue(makeMember({ userId: ME, role: 'member' }));
      conversations.findTypeAndPermissions.mockResolvedValue({
        id: CONV,
        type: 'group',
        permissions: { ...DEFAULT_CONVERSATION_PERMISSIONS, post: 'admin' },
      });
      await expect(service.send(ACTOR, CONV, { text: 'Пост' }, 'key-1')).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        message: 'Posting in this conversation requires permission',
      });
      expect(repo.insertMessage).not.toHaveBeenCalled();

      repo.findByIdInConversation.mockImplementation(async (_c: string, id: string) =>
        id === 'root-1' ? makeMessage({ id: 'root-1', seq: 1n, authorId: PEER }) : null,
      );
      repo.insertMessage.mockResolvedValue(
        makeMessage({ id: 'msg-t', seq: 7n, threadRootId: 'root-1' }),
      );
      repo.countThreadReplies.mockResolvedValue(1);

      const ok = await service.send(
        ACTOR,
        CONV,
        { text: 'Ответ', threadRootId: 'root-1' },
        'key-2',
      );

      expect(ok.replayed).toBe(false);
      expect(repo.touchLastMessageAt).not.toHaveBeenCalled();
      // Автор корня (PEER) — участник 'author' с первого ответа; отвечающий — 'replier'.
      expect(threadParticipants.upsert).toHaveBeenCalledWith('root-1', PEER, 'author', TX);
      expect(threadParticipants.upsert).toHaveBeenCalledWith('root-1', ME, 'replier', TX);
      expect(eventBus.emit).toHaveBeenCalledTimes(1); // только MESSAGE_SENT, без THREAD_CREATED
      expect(eventBus.emit).toHaveBeenCalledWith(
        TX,
        CHAT_EVENTS.MESSAGE_SENT,
        expect.objectContaining({ messageId: 'msg-t', seq: 7, threadRootId: 'root-1' }),
        expect.anything(),
      );
    });

    it('threadRoot не существует или сам является ответом → NOT_FOUND "Thread root not found"', async () => {
      repo.findByIdInConversation.mockResolvedValue(
        makeMessage({ id: 'r', threadRootId: 'root-0' }),
      );
      await expect(
        service.send(ACTOR, CONV, { text: 'Ответ', threadRootId: 'r' }, 'k1'),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: 'Thread root not found',
      });
      await expect(
        service.send(ACTOR, CONV, { text: 'Ответ', threadRootId: 'ghost' }, 'k2'),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: 'Thread root not found',
      });
      expect(repo.insertMessage).not.toHaveBeenCalled();
    });

    it('цитата: удалённый оригинал → снапшот-надгробие; живой → усечённый текст и вид вложения', async () => {
      repo.findByIdInConversation.mockResolvedValue(
        makeMessage({ id: 'orig-1', authorId: PEER, text: 'Было', deletedAt: new Date() }),
      );
      repo.insertMessage.mockResolvedValue(
        makeMessage({ id: 'msg-r', seq: 7n, replyToId: 'orig-1' }),
      );

      await service.send(
        ACTOR,
        CONV,
        { text: 'Ответ', replyToId: 'orig-1', quoteText: 'цитата' },
        'key-3',
      );

      expect(repo.attachmentsFor).not.toHaveBeenCalled(); // у надгробия вложения не читаются
      expect(repo.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          replyToId: 'orig-1',
          replySnapshot: {
            authorId: PEER,
            text: '',
            quoteText: null,
            attachmentKind: null,
            stickerFileId: null,
            stickerEmoji: null,
            stickerMime: null,
          },
        }),
        TX,
      );

      repo.findByIdInConversation.mockResolvedValue(
        makeMessage({ id: 'orig-2', authorId: PEER, text: 'х'.repeat(200) }),
      );
      repo.attachmentsFor.mockResolvedValue([
        {
          messageId: 'orig-2',
          id: 'a1',
          name: 'фото.png',
          size: 1,
          mime: 'image/png',
          kind: 'image',
          width: null,
          height: null,
          sortOrder: 0,
        },
      ]);
      repo.insertMessage.mockResolvedValue(
        makeMessage({ id: 'msg-r2', seq: 7n, replyToId: 'orig-2' }),
      );

      await service.send(ACTOR, CONV, { text: 'Ответ', replyToId: 'orig-2' }, 'key-4');
      // Вложения оригинала читаются ПО соединению транзакции (правило пула).
      expect(repo.attachmentsFor).toHaveBeenCalledWith(['orig-2'], TX);

      expect(repo.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          replySnapshot: {
            authorId: PEER,
            text: 'х'.repeat(160),
            quoteText: null,
            attachmentKind: 'image',
            stickerFileId: null,
            stickerEmoji: null,
            stickerMime: null,
          },
        }),
        TX,
      );
    });

    it('цитата сообщения НЕ из этой беседы (#344) → 404, сообщение не создаётся', async () => {
      repo.findByIdInConversation.mockResolvedValue(null);
      await expect(
        service.send(ACTOR, CONV, { text: 'Ответ', replyToId: 'foreign-1' }, 'key-fr'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(repo.findByIdInConversation).toHaveBeenCalledWith(CONV, 'foreign-1', TX);
      expect(repo.insertMessage).not.toHaveBeenCalled();
    });

    it('цитата-на-стикер: снапшот несёт fileId/эмодзи/mime для мини-глифа (#288)', async () => {
      repo.findByIdInConversation.mockResolvedValue(
        makeMessage({ id: 'orig-st', authorId: PEER, text: '' }),
      );
      repo.attachmentsFor.mockResolvedValue([
        {
          messageId: 'orig-st',
          id: 'a-st',
          name: 'sticker.webp',
          size: 24_000,
          mime: 'image/webp',
          kind: 'sticker',
          width: 512,
          height: 512,
          sortOrder: 0,
          fileId: 'file-st-1',
          stickerMeta: {
            packId: 'p-1',
            packTitle: 'Пак',
            packScope: 'personal',
            emojis: ['🔥', '😀'],
          },
        },
      ]);
      repo.insertMessage.mockResolvedValue(
        makeMessage({ id: 'msg-rs', seq: 8n, replyToId: 'orig-st' }),
      );

      await service.send(ACTOR, CONV, { text: 'Ответ', replyToId: 'orig-st' }, 'key-st');

      expect(repo.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          replySnapshot: expect.objectContaining({
            attachmentKind: 'sticker',
            stickerFileId: 'file-st-1',
            stickerEmoji: '🔥',
            stickerMime: 'image/webp',
          }),
        }),
        TX,
      );
    });

    it('обычная отправка: seq, вложения, гашение черновика/снуза, активность, MESSAGE_SENT', async () => {
      const body: SendMessageBody = { text: 'Привет', attachmentIds: ['att-1'] };

      const result = await service.send(ACTOR, CONV, body, 'key-5');

      expect(result).toMatchObject({ replayed: false, message: { id: 'msg-new' } });
      expect(repo.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: CONV,
          authorId: ME,
          clientMessageId: 'key-5',
          text: 'Привет',
          seq: 7n,
          threadRootId: null,
          replySnapshot: null,
        }),
        TX,
      );
      expect(repo.claimAttachments).toHaveBeenCalledWith('msg-new', ['att-1'], ME, TX, []);
      expect(conversations.clearDraft).toHaveBeenCalledWith(CONV, ME, TX);
      expect(conversations.unsnooze).toHaveBeenCalledWith(CONV, ME, TX);
      // Активность раскрывает беседу скрывшим участникам — той же tx (#103).
      expect(conversations.revealHidden).toHaveBeenCalledWith(CONV, TX);
      expect(repo.touchLastMessageAt).toHaveBeenCalledWith(CONV, TX);
      expect(threadParticipants.upsert).not.toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        TX,
        CHAT_EVENTS.MESSAGE_SENT,
        {
          conversationId: CONV,
          messageId: 'msg-new',
          seq: 7,
          authorId: ME,
          threadRootId: null,
          forwarded: false,
          urgent: false,
          mentionedUserIds: [],
          // Полный DTO в payload (раунд 3): локальное применение по seq.
          message: FRESH_DTO,
        },
        expect.objectContaining({ actorId: ME, aggregateType: 'conversation', aggregateId: CONV }),
      );
    });

    it('переименования окна отправки уходят в claim (#146): имя применяется до DTO/события', async () => {
      const body: SendMessageBody = {
        text: 'Файл',
        attachmentIds: ['att-1'],
        attachmentRenames: [{ id: 'att-1', name: 'Смета на согласование.pdf' }],
      };

      await service.send(ACTOR, CONV, body, 'key-6');

      expect(repo.claimAttachments).toHaveBeenCalledWith('msg-new', ['att-1'], ME, TX, [
        { id: 'att-1', name: 'Смета на согласование.pdf' },
      ]);
    });
  });

  describe('readConversation (квитанции просмотров, #102 раунд 2)', () => {
    it('не член беседы → NOT_FOUND', async () => {
      conversations.findMembership.mockResolvedValue(null);
      await expect(service.readConversation(ME, CONV, 5)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it('upToSeq выше last_seq → кламп к last_seq (фантомное «всё прочитано» невозможно)', async () => {
      conversations.findLastSeq.mockResolvedValue(7n);
      repo.advanceReadCursor.mockResolvedValue({ advanced: true, lastReadAt: null });
      const result = await service.readConversation(ME, CONV, 999);
      expect(result).toEqual({ upToSeq: 7 });
      expect(repo.advanceReadCursor).toHaveBeenCalledWith(CONV, ME, 7n, TX);
    });

    it('курсор двинулся → событие MESSAGE_READ с upToSeq и readAt из строки', async () => {
      conversations.findLastSeq.mockResolvedValue(10n);
      const readAt = new Date('2026-09-25T10:00:00Z');
      repo.advanceReadCursor.mockResolvedValue({ advanced: true, lastReadAt: readAt });
      await service.readConversation(ME, CONV, 4);
      expect(eventBus.emit).toHaveBeenCalledWith(
        TX,
        CHAT_EVENTS.MESSAGE_READ,
        { conversationId: CONV, userId: ME, upToSeq: 4, readAt: readAt.toISOString() },
        { actorId: ME, aggregateType: 'conversation', aggregateId: CONV },
      );
    });

    it('повтор без движения (GREATEST ниже/равно, без правок) → БЕЗ события', async () => {
      conversations.findLastSeq.mockResolvedValue(10n);
      repo.advanceReadCursor.mockResolvedValue({ advanced: false, lastReadAt: null });
      const result = await service.readConversation(ME, CONV, 4);
      expect(result).toEqual({ upToSeq: 4 });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });
});
