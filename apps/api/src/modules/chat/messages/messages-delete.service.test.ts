// Удаление сообщений (#163/#245) — MessagesDeleteService, выделен из
// MessagesService (I5): правило следа «по ответам», каскады якорей/закладок,
// пакетное удаление. Матрица модерации — messages-delete-moderation.service.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_EVENTS } from '@nodus/contracts';

import { MessagesDeleteService } from './messages-delete.service.js';
import type { MemberRow } from '../conversations/conversations.repository.js';
import type { MessageRow } from './message-row.js';

const CONV = 'conv-1';
const ME = 'me-1';
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

describe('MessagesDeleteService (#163: правило следа)', () => {
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
  const favoritesRepo = { deleteByMessage: vi.fn() };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const vault = { applyMessageDeleted: vi.fn(async () => {}) };
  let service: MessagesDeleteService;

  beforeEach(() => {
    vi.clearAllMocks();
    conversations.findMembership.mockResolvedValue(makeMember({ userId: ME, role: 'member' }));
    conversations.findTypeAndPermissions.mockResolvedValue({ id: CONV, type: 'group' });
    conversations.isNotesConversation.mockResolvedValue(false);
    conversations.listMembers.mockResolvedValue([]);
    favoritesRepo.deleteByMessage.mockResolvedValue([]);
    repo.tombstone.mockImplementation(async (_c: string, id: string, obliterated: boolean) =>
      makeMessage({ id, obliterated, deletedAt: new Date('2026-09-24T14:00:00Z') }),
    );
    service = new MessagesDeleteService(
      repo as never,
      repo as never, // жизненный цикл (MessagesLifecycleRepository, I5)
      conversations as never,
      txRunner as never,
      eventBus as never,
      favoritesRepo as never,
      vault as never,
      { append: vi.fn(async () => undefined) } as never,
    );
  });

  describe('delete', () => {
    it('живых ответов нет — бесследно, даже если прочитали (#163: прочтения не решают)', async () => {
      repo.findByIdInConversation.mockResolvedValue(makeMessage({ seq: 3n }));
      repo.hasLiveReplies.mockResolvedValue(false);
      conversations.listMembers.mockResolvedValue([
        makeMember({ userId: ME }),
        makeMember({ lastReadSeq: 3n }),
      ]);

      const result = await service.delete(ME, CONV, 'msg-1');

      expect(repo.hasLiveReplies).toHaveBeenCalledWith(CONV, 'msg-1', TX);
      expect(result.obliterated).toBe(true);
      expect(repo.tombstone).toHaveBeenCalledWith(CONV, 'msg-1', true, TX);
      expect(repo.deletePinByMessage).toHaveBeenCalledWith('msg-1', TX);
      expect(repo.markRepliesDeleted).toHaveBeenCalledWith('msg-1', TX);
      expect(eventBus.emit).toHaveBeenCalledWith(
        TX,
        CHAT_EVENTS.MESSAGE_DELETED,
        { conversationId: CONV, messageId: 'msg-1', obliterated: true },
        expect.anything(),
      );
    });

    it('есть живой ответ → надгробие, даже если никто не читал', async () => {
      repo.findByIdInConversation.mockResolvedValue(makeMessage({ seq: 3n }));
      repo.hasLiveReplies.mockResolvedValue(true);
      conversations.listMembers.mockResolvedValue([
        makeMember({ userId: ME }),
        makeMember({ lastReadSeq: 0n }),
      ]);

      const result = await service.delete(ME, CONV, 'msg-1');

      expect(result.obliterated).toBe(false);
      expect(repo.tombstone).toHaveBeenCalledWith(CONV, 'msg-1', false, TX);
      expect(repo.deletePinByMessage).toHaveBeenCalledWith('msg-1', TX);
      expect(repo.markRepliesDeleted).toHaveBeenCalledWith('msg-1', TX);
    });

    it('«Избранное» (#215): беседа с собой — бесследно ВСЕГДА, даже при живых ответах', async () => {
      repo.findByIdInConversation.mockResolvedValue(makeMessage({ seq: 3n }));
      repo.hasLiveReplies.mockResolvedValue(true);
      conversations.isNotesConversation.mockResolvedValue(true);

      const result = await service.delete(ME, CONV, 'msg-1');

      expect(result.obliterated).toBe(true);
      expect(repo.tombstone).toHaveBeenCalledWith(CONV, 'msg-1', true, TX);
    });

    it('выродившаяся группа с 1 участником-автором — гвард НЕ действует: надгробие по #163 (security-ревью #215)', async () => {
      repo.findByIdInConversation.mockResolvedValue(makeMessage({ seq: 3n }));
      repo.hasLiveReplies.mockResolvedValue(true);
      conversations.isNotesConversation.mockResolvedValue(false); // не direct-with-self
      conversations.listMembers.mockResolvedValue([makeMember({ userId: ME })]);

      const result = await service.delete(ME, CONV, 'msg-1');

      expect(result.obliterated).toBe(false);
      expect(repo.tombstone).toHaveBeenCalledWith(CONV, 'msg-1', false, TX);
    });

    it('каскад закладок (#215): удаление оригинала гасит строки избранного у всех владельцев + событие каждому', async () => {
      repo.findByIdInConversation.mockResolvedValue(makeMessage({ seq: 3n }));
      repo.hasLiveReplies.mockResolvedValue(false);
      conversations.listMembers.mockResolvedValue([
        makeMember({ userId: ME }),
        makeMember({ lastReadSeq: 3n }),
      ]);
      favoritesRepo.deleteByMessage.mockResolvedValue(['u-1', 'u-2']);

      await service.delete(ME, CONV, 'msg-1');

      expect(favoritesRepo.deleteByMessage).toHaveBeenCalledWith('msg-1', TX);
      expect(eventBus.emit).toHaveBeenCalledWith(
        TX,
        CHAT_EVENTS.FAVORITE_REMOVED,
        { userId: 'u-1', conversationId: CONV, messageId: 'msg-1' },
        expect.anything(),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        TX,
        CHAT_EVENTS.FAVORITE_REMOVED,
        { userId: 'u-2', conversationId: CONV, messageId: 'msg-1' },
        expect.anything(),
      );
    });

    it('каскад: удаление ответа коллапсирует надгробие-родителя без живых ответов + своё событие', async () => {
      const source = makeMessage({ id: 'msg-reply', replyToId: 'msg-parent' });
      repo.findByIdInConversation.mockResolvedValue(source);
      repo.hasLiveReplies.mockResolvedValue(false);
      // UPDATE RETURNING сохраняет все колонки строки (в т.ч. replyToId)
      repo.tombstone.mockImplementation(async (_c: string, id: string, obliterated: boolean) =>
        makeMessage({ ...source, id, obliterated, deletedAt: new Date() }),
      );
      repo.obliterateTombstone.mockResolvedValue(true);

      await service.delete(ME, CONV, 'msg-reply');

      expect(repo.obliterateTombstone).toHaveBeenCalledWith(CONV, 'msg-parent', TX);
      expect(eventBus.emit).toHaveBeenCalledWith(
        TX,
        CHAT_EVENTS.MESSAGE_DELETED,
        { conversationId: CONV, messageId: 'msg-parent', obliterated: true },
        expect.anything(),
      );
    });

    it('каскад: живой родитель или второй якорь — коллапса и лишних событий нет', async () => {
      const source = makeMessage({
        id: 'msg-reply',
        replyToId: 'msg-parent',
        threadRootId: 'root-1',
      });
      repo.findByIdInConversation.mockResolvedValue(source);
      repo.hasLiveReplies.mockResolvedValue(false);
      repo.tombstone.mockImplementation(async (_c: string, id: string, obliterated: boolean) =>
        makeMessage({ ...source, id, obliterated, deletedAt: new Date() }),
      );
      repo.obliterateTombstone.mockResolvedValue(false);

      await service.delete(ME, CONV, 'msg-reply');

      expect(repo.obliterateTombstone).toHaveBeenCalledTimes(2);
      expect(repo.obliterateTombstone).toHaveBeenCalledWith(CONV, 'msg-parent', TX);
      expect(repo.obliterateTombstone).toHaveBeenCalledWith(CONV, 'root-1', TX);
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('batchDelete', () => {
    it('чужие/несуществующие/удалённые — молча (участник без права модерации); {removed, tombstones} по правилу ответов (#163)', async () => {
      const byId: Record<string, MessageRow | null> = {
        'own-no-replies': makeMessage({ id: 'own-no-replies', seq: 10n }),
        foreign: makeMessage({ id: 'foreign', authorId: PEER, seq: 11n }),
        ghost: null,
        'own-deleted': makeMessage({ id: 'own-deleted', seq: 12n, deletedAt: new Date() }),
        'own-answered': makeMessage({ id: 'own-answered', seq: 2n }),
      };
      repo.findByIdInConversation.mockImplementation(
        async (_c: string, id: string) => byId[id] ?? null,
      );
      repo.hasLiveReplies.mockImplementation(
        async (_c: string, id: string) => id === 'own-answered',
      );

      const result = await service.batchDelete(ME, CONV, [
        'own-no-replies',
        'foreign',
        'ghost',
        'own-deleted',
        'own-answered',
      ]);

      expect(result.removed).toEqual(['own-no-replies']);
      expect(result.tombstones).toHaveLength(1);
      expect(result.tombstones[0]?.message.id).toBe('own-answered');
      expect(repo.tombstone).toHaveBeenCalledTimes(2);
      expect(repo.tombstone).toHaveBeenCalledWith(CONV, 'own-no-replies', true, TX);
      expect(repo.tombstone).toHaveBeenCalledWith(CONV, 'own-answered', false, TX);
      expect(repo.deletePinByMessage).toHaveBeenCalledTimes(2);
      expect(repo.markRepliesDeleted).toHaveBeenCalledTimes(2);
    });
  });
});
