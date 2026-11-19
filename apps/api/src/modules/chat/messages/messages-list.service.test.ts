import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeCursor } from '../../../core/pagination/cursor.util.js';
import { MessagesService } from './messages.service.js';
import type { MessageRow } from './message-row.js';
import { z } from 'zod';

const CONV = 'conv-1';
const ME = 'me-1';
const ROOT = 'root-1';

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

const cursorSchema = z.object({ s: z.number() });

/** Лента/тред: курсор страницы (аудит #317 — корень треда не курсор). */
describe('MessagesService.list — курсор страницы', () => {
  const repo = { listPage: vi.fn() };
  const conversations = {
    findMembership: vi.fn(async () => ({ role: 'member' })),
    listMembers: vi.fn(async () => []),
  };
  const mapper = {
    toDtos: vi.fn(async (rows: MessageRow[]) => rows.map((r) => ({ id: r.id, attachments: [] }))),
  };
  let service: MessagesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MessagesService(
      repo as never,
      repo as never, // запись (MessagesWriteRepository)
      repo as never, // правка/удаление (MessagesLifecycleRepository)
      repo as never, // прочитанность (MessagesReadStateRepository)
      {} as never,
      conversations as never,
      conversations as never, // запись участия (ConversationMembersRepository)
      conversations as never, // черновики (ConversationDraftsRepository)
      mapper as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { enqueue: vi.fn(async () => undefined) } as never,
      { canPost: vi.fn(async () => true) } as never,
    );
  });

  it('первая страница треда: корень первым, курсор — по самому старому ОТВЕТУ', async () => {
    // Arrange: корень seq=1 вставлен первым, ответы 40..41, есть ещё страницы.
    repo.listPage.mockResolvedValue({
      rows: [
        makeMessage({ id: ROOT, seq: 1n }),
        makeMessage({ id: 'r-40', seq: 40n, threadRootId: ROOT }),
        makeMessage({ id: 'r-41', seq: 41n, threadRootId: ROOT }),
      ],
      hasMore: true,
    });

    // Act
    const page = await service.list(ME, CONV, { limit: 2, threadRootId: ROOT });

    // Assert: курсор = 40 (не seq корня — иначе вторая страница пуста).
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor!, cursorSchema)).toEqual({ s: 40 });
  });

  it('лента без треда: курсор — по первой (старейшей) строке страницы', async () => {
    repo.listPage.mockResolvedValue({
      rows: [makeMessage({ id: 'm-5', seq: 5n }), makeMessage({ id: 'm-6', seq: 6n })],
      hasMore: true,
    });

    const page = await service.list(ME, CONV, { limit: 2 });

    expect(decodeCursor(page.nextCursor!, cursorSchema)).toEqual({ s: 5 });
  });

  it('последняя страница → nextCursor null', async () => {
    repo.listPage.mockResolvedValue({
      rows: [makeMessage({ id: ROOT, seq: 1n })],
      hasMore: false,
    });

    const page = await service.list(ME, CONV, { limit: 2, threadRootId: ROOT });

    expect(page.nextCursor).toBeNull();
  });
});
