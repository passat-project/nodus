import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_EVENTS,
  ErrorCode,
  type CreateConversationBody,
  type ListConversationsQuery,
} from '@nodus/contracts';

import { encodeCursor } from '../../../core/pagination/cursor.util.js';
import { DEFAULT_CONVERSATION_PERMISSIONS } from '../permissions.js';
import { ConversationsService } from './conversations.service.js';
import type { ConversationListRow } from './conversations-list.select.js';

const TX = 'tx-handle';

function makeListRow(overrides: Partial<ConversationListRow> = {}): ConversationListRow {
  return {
    id: 'conv-1',
    type: 'group',
    title: 'Группа',
    description: null,
    visibility: 'closed',
    permissions: DEFAULT_CONVERSATION_PERMISSIONS,
    avatar_file_id: null,
    task_id: null,
    project_id: null,
    letter_id: null,
    last_message_at: new Date('2026-09-24T10:00:00Z'),
    last_activity_at: new Date('2026-09-24T10:00:00Z'),
    role: 'owner',
    pinned: false,
    muted: false,
    snoozed: false,
    draft_text: null,
    draft_revision: null,
    draft_updated_at: null,
    unread_count: 0,
    my_last_read_seq: 0n,
    lm_id: null,
    lm_seq: null,
    lm_author_id: null,
    lm_client_message_id: null,
    lm_text: null,
    lm_urgent: null,
    lm_reply_to_id: null,
    lm_reply_snapshot: null,
    lm_thread_root_id: null,
    lm_fwd_conversation_id: null,
    lm_fwd_message_id: null,
    lm_fwd_author_id: null,
    lm_fwd_thread_root_id: null,
    lm_edited_at: null,
    lm_deleted_at: null,
    lm_created_at: null,
    ...overrides,
  };
}

describe('ConversationsService', () => {
  const repo = {
    listForUser: vi.fn(),
    findListItem: vi.fn(),
    findListItemAsReader: vi.fn(),
    findTaskId: vi.fn(),
    findMembership: vi.fn(),
    findOrCreateDirect: vi.fn(),
    createGroup: vi.fn(),
    updateMemberSettings: vi.fn(),
    listMembers: vi.fn(),
    putDraft: vi.fn(),
  };
  const taskChat = { isDecider: vi.fn(async () => false) };
  const items = { toItem: vi.fn(), toItems: vi.fn() };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const avatars = { process: vi.fn() };
  const userProfiles = {
    findRefs: vi.fn(),
    filterActiveUserIds: vi.fn(async (ids: string[]) => ids),
    searchByDisplayName: vi.fn(),
    findMentionMatches: vi.fn(),
  };

  let service: ConversationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    items.toItem.mockImplementation(async (row: { id: string }) => ({ id: row.id }));
    // Список берёт страницу ОДНИМ батчем (#124): toItems вместо toItem-поштучно.
    items.toItems.mockImplementation(async (rows: { id: string }[]) =>
      rows.map((row: { id: string }) => ({ id: row.id })),
    );
    repo.listMembers.mockResolvedValue([]);
    repo.findListItem.mockImplementation(async (conversationId: string) =>
      makeListRow({ id: conversationId }),
    );
    userProfiles.findRefs.mockResolvedValue([]);
    service = new ConversationsService(
      repo as never,
      repo as never, // запись беседы (ConversationsWriteRepository)
      repo as never, // запись участия (ConversationMembersRepository)
      repo as never, // черновики (ConversationDraftsRepository)
      items as never,
      txRunner as never,
      eventBus as never,
      avatars as never,
      userProfiles as never,
      taskChat as never,
    );
  });

  describe('list', () => {
    it('без курсора и поиска → cursor/search undefined в репозитории, nextCursor null', async () => {
      repo.listForUser.mockResolvedValue([makeListRow()]);

      const page = await service.list('me-1', { limit: 50 });

      expect(repo.listForUser).toHaveBeenCalledWith(
        'me-1',
        expect.objectContaining({
          limit: 50,
          cursor: undefined,
          searchTitle: undefined,
          searchUserIds: undefined,
        }),
      );
      expect(userProfiles.searchByDisplayName).not.toHaveBeenCalled();
      expect(page.items).toEqual([{ id: 'conv-1' }]);
      expect(page.nextCursor).toBeNull();
    });

    it('валидный курсор декодируется по схеме и уходит в репозиторий', async () => {
      repo.listForUser.mockResolvedValue([]);
      const cursor = encodeCursor({
        at: '2026-09-24T10:00:00.000Z',
        id: '11111111-1111-4111-8111-111111111111',
      });

      await service.list('me-1', { limit: 50, cursor });

      expect(repo.listForUser).toHaveBeenCalledWith(
        'me-1',
        expect.objectContaining({
          cursor: { at: '2026-09-24T10:00:00.000Z', id: '11111111-1111-4111-8111-111111111111' },
        }),
      );
    });

    it('поиск → searchByDisplayName(query, 100), ids переданы в репозиторий', async () => {
      repo.listForUser.mockResolvedValue([]);
      userProfiles.searchByDisplayName.mockResolvedValue([
        { id: 'u-2', displayName: 'Петров Пётр', avatarUrl: null },
        { id: 'u-3', displayName: 'Сидоров Пётр', avatarUrl: null },
      ]);

      await service.list('me-1', { limit: 50, search: 'Петров' });

      expect(userProfiles.searchByDisplayName).toHaveBeenCalledWith('Петров', 100);
      expect(repo.listForUser).toHaveBeenCalledWith(
        'me-1',
        expect.objectContaining({ searchTitle: 'Петров', searchUserIds: ['u-2', 'u-3'] }),
      );
    });

    it('hasMore (limit+1) → items ровно limit, nextCursor по последней строке страницы', async () => {
      repo.listForUser.mockResolvedValue([
        makeListRow({ id: 'c1' }),
        makeListRow({
          id: 'c2',
          last_message_at: new Date('2026-09-24T09:00:00Z'),
          last_activity_at: new Date('2026-09-24T09:00:00Z'),
        }),
        makeListRow({
          id: 'c3',
          last_message_at: new Date('2026-09-24T08:00:00Z'),
          last_activity_at: new Date('2026-09-24T08:00:00Z'),
        }),
      ]);

      const page = await service.list('me-1', { limit: 2 } as ListConversationsQuery);

      expect(page.items.map((item) => item.id)).toEqual(['c1', 'c2']);
      expect(page.nextCursor).toBe(encodeCursor({ at: '2026-09-24T09:00:00.000Z', id: 'c2' }));
    });

    it('nextCursor — по last_activity_at (ось сортировки), не last_message_at (#215)', async () => {
      // Arrange: «Избранное» — последняя звезда свежее последнего сообщения.
      repo.listForUser.mockResolvedValue([
        makeListRow({
          id: 'notes',
          last_message_at: new Date('2026-09-24T08:00:00Z'),
          last_activity_at: new Date('2026-09-24T11:00:00Z'),
        }),
        makeListRow({ id: 'c2' }),
      ]);

      // Act
      const page = await service.list('me-1', { limit: 1 } as ListConversationsQuery);

      // Assert
      expect(page.nextCursor).toBe(encodeCursor({ at: '2026-09-24T11:00:00.000Z', id: 'notes' }));
    });
  });

  describe('create', () => {
    const body: CreateConversationBody = {
      type: 'group',
      title: 'Проект',
      memberIds: ['u-1', 'u-1', 'me-1', 'ghost-id'],
      permissions: { post: 'admin' },
    };

    it('дедуп участников, создатель, неизвестные и уволенные исключены (#343)', async () => {
      repo.createGroup.mockResolvedValue('conv-new');
      userProfiles.filterActiveUserIds.mockResolvedValueOnce(['u-1']);

      const item = await service.create('me-1', body);

      expect(userProfiles.filterActiveUserIds).toHaveBeenCalledWith([
        'u-1',
        'u-1',
        'me-1',
        'ghost-id',
      ]);
      expect(repo.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'group',
          title: 'Проект',
          createdBy: 'me-1',
          memberIds: ['u-1'],
          permissions: { ...DEFAULT_CONVERSATION_PERMISSIONS, post: 'admin' },
        }),
        TX,
      );
      expect(item).toEqual({ id: 'conv-new' });
    });

    it('события CONVERSATION_CREATED и MEMBER_ADDED — в той же транзакции', async () => {
      repo.createGroup.mockResolvedValue('conv-new');
      userProfiles.filterActiveUserIds.mockResolvedValueOnce(['u-1']);

      await service.create('me-1', body);

      expect(eventBus.emit).toHaveBeenNthCalledWith(
        1,
        TX,
        CHAT_EVENTS.CONVERSATION_CREATED,
        {
          conversationId: 'conv-new',
          type: 'group',
          title: 'Проект',
          createdBy: 'me-1',
          memberIds: ['me-1', 'u-1'],
        },
        expect.objectContaining({
          actorId: 'me-1',
          aggregateType: 'conversation',
          aggregateId: 'conv-new',
        }),
      );
      expect(eventBus.emit).toHaveBeenNthCalledWith(
        2,
        TX,
        CHAT_EVENTS.MEMBER_ADDED,
        { conversationId: 'conv-new', userIds: ['u-1'], role: 'member' },
        expect.anything(),
      );
    });

    it('без участников → MEMBER_ADDED не эмитится', async () => {
      repo.createGroup.mockResolvedValue('conv-new');

      await service.create('me-1', { type: 'project_channel', title: 'Канал' });

      expect(repo.createGroup).toHaveBeenCalledWith(expect.objectContaining({ memberIds: [] }), TX);
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith(
        TX,
        CHAT_EVENTS.CONVERSATION_CREATED,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('findOrCreateDirect', () => {
    it('порт не нашёл peer → NOT_FOUND "User not found", транзакции нет', async () => {
      userProfiles.findRefs.mockResolvedValue([]);

      await expect(service.findOrCreateDirect('me-1', 'ghost-id')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: 'User not found',
      });
      expect(txRunner.run).not.toHaveBeenCalled();
    });

    it('пара существует (created: false) → событие НЕ эмитится', async () => {
      userProfiles.findRefs.mockResolvedValue([{ id: 'u-2', displayName: 'Два', avatarUrl: null }]);
      repo.findOrCreateDirect.mockResolvedValue({ id: 'conv-d', created: false });

      const result = await service.findOrCreateDirect('me-1', 'u-2');

      expect(result.created).toBe(false);
      expect(result.item).toEqual({ id: 'conv-d' });
      expect(repo.findOrCreateDirect).toHaveBeenCalledWith('me-1', 'u-2', TX, true);
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('уволенный peer (#343): новой беседы нет — 404; существующая открывается (история)', async () => {
      userProfiles.findRefs.mockResolvedValue([
        { id: 'u-x', displayName: 'Уволен', avatarUrl: null },
      ]);
      userProfiles.filterActiveUserIds.mockResolvedValueOnce([]);
      repo.findOrCreateDirect.mockResolvedValueOnce(null);
      await expect(service.findOrCreateDirect('me-1', 'u-x')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
      expect(repo.findOrCreateDirect).toHaveBeenCalledWith('me-1', 'u-x', TX, false);

      userProfiles.filterActiveUserIds.mockResolvedValueOnce([]);
      repo.findOrCreateDirect.mockResolvedValueOnce({ id: 'conv-old', created: false });
      const result = await service.findOrCreateDirect('me-1', 'u-x');
      expect(result.created).toBe(false);
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('создан direct → CONVERSATION_CREATED с дедупом [создатель, peer]', async () => {
      userProfiles.findRefs.mockResolvedValue([{ id: 'me-1', displayName: 'Я', avatarUrl: null }]);
      repo.findOrCreateDirect.mockResolvedValue({ id: 'conv-n', created: true });

      await service.findOrCreateDirect('me-1', 'me-1'); // «Заметки»: peer = сам

      expect(eventBus.emit).toHaveBeenCalledWith(
        TX,
        CHAT_EVENTS.CONVERSATION_CREATED,
        expect.objectContaining({ memberIds: ['me-1'] }),
        expect.anything(),
      );
    });
  });

  describe('patch / putDraft', () => {
    it('patch: не член → NOT_FOUND, настройки не трогаются', async () => {
      repo.findMembership.mockResolvedValue(null);

      await expect(service.patch('me-1', 'conv-1', { pinned: true })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: 'Conversation not found',
      });
      expect(repo.updateMemberSettings).not.toHaveBeenCalled();
    });

    it('patch: член → настройки прокинуты в репозиторий', async () => {
      repo.findMembership.mockResolvedValue({ conversationId: 'conv-1', userId: 'me-1' });

      const item = await service.patch('me-1', 'conv-1', { pinned: true, muted: true });

      expect(repo.updateMemberSettings).toHaveBeenCalledWith('conv-1', 'me-1', {
        pinned: true,
        muted: true,
      });
      expect(item).toEqual({ id: 'conv-1' });
    });

    it('putDraft: не член → NOT_FOUND', async () => {
      repo.findMembership.mockResolvedValue(null);

      await expect(service.putDraft('me-1', 'conv-1', 'Черновик')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
      expect(repo.putDraft).not.toHaveBeenCalled();
    });

    it('putDraft: черновик замаплен (updatedAt → ISO); пустой ответ → null', async () => {
      repo.findMembership.mockResolvedValue({ conversationId: 'conv-1', userId: 'me-1' });
      repo.putDraft.mockResolvedValue({
        text: 'Черновик',
        revision: 3,
        updatedAt: new Date('2026-09-24T12:00:00Z'),
      });

      const draft = await service.putDraft('me-1', 'conv-1', 'Черновик');

      expect(repo.putDraft).toHaveBeenCalledWith('conv-1', 'me-1', 'Черновик');
      expect(draft).toEqual({
        text: 'Черновик',
        revision: 3,
        updatedAt: '2026-09-24T12:00:00.000Z',
      });

      repo.putDraft.mockResolvedValue(null);
      expect(await service.putDraft('me-1', 'conv-1', '')).toBeNull();
    });
  });
  describe('item — читатель-решающий (#433)', () => {
    it('не участник-решающий получает read-only строку, посторонний — 404', async () => {
      repo.findListItem.mockResolvedValue(null);
      repo.findTaskId.mockResolvedValue('task-1');
      items.toItem.mockImplementation(
        async (row: { id: string; readerAccess?: boolean }) =>
          ({ id: row.id, readOnly: row.readerAccess === true }) as never,
      );
      repo.findListItemAsReader.mockResolvedValue(makeListRow({ readerAccess: true }) as never);
      repo.listMembers.mockResolvedValue([]);
      taskChat.isDecider.mockResolvedValue(true);

      const item = await service.item('conv-1', 'me-1');
      expect(item).toMatchObject({ readOnly: true });
      expect(repo.findListItemAsReader).toHaveBeenCalledWith('conv-1', 'me-1');

      taskChat.isDecider.mockResolvedValue(false);
      await expect(service.item('conv-1', 'me-2')).rejects.toThrow();
      expect(repo.findListItemAsReader).toHaveBeenCalledTimes(1);
    });
  });
});
