import { describe, expect, it } from 'vitest';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import type { MemberRow } from '../conversations/conversations.repository.js';
import type { MessageRow } from './message-row.js';
import { MessageDtoMapper } from './message-dto.mapper.js';

const T0 = new Date('2026-11-19T09:00:00Z');
const T2 = new Date('2026-11-19T11:00:00Z');

function member(overrides: Partial<MemberRow> = {}): MemberRow {
  const lastReadSeq = overrides.lastReadSeq ?? 0n;
  const lastReadAt = overrides.lastReadAt ?? null;
  return {
    conversationId: 'conv-1',
    userId: 'peer-1',
    role: 'member',
    lastReadSeq,
    lastReadAt,
    lastFeedReadSeq: lastReadSeq,
    lastFeedReadAt: lastReadAt,
    joinedAt: T0,
    pinned: false,
    muted: false,
    snoozed: false,
    hidden: false,
    ...overrides,
  };
}

function row(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm-1',
    conversationId: 'conv-1',
    seq: 5n,
    authorId: 'me-1',
    clientMessageId: '',
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
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

type ThreadCursors = ReadonlyMap<
  string,
  { userId: string; lastReadSeq: bigint; lastReadAt: Date | null }[]
>;

/** Маппер с пустыми батчами и заданными курсорами тредов. */
function mapper(threadCursors: ThreadCursors = new Map()): MessageDtoMapper {
  const messages = {
    reactionsFor: async () => [],
    attachmentsFor: async () => [],
    threadReplyCounts: async () => [],
    findByIds: async () => [],
  };
  const threadReads = { readCursorsFor: async () => threadCursors };
  return new MessageDtoMapper(
    messages as never,
    messages as never,
    { pinnedIds: async () => new Set<string>() } as never,
    threadReads as never,
    {
      findRefs: async (ids: string[]) =>
        ids.map((id) => ({ id, displayName: id, avatarUrl: null })),
    } as never,
    new SignedUrlService({ STORAGE_URL_SECRET: 'test-secret-32-chars-aaaaaaaaaaaa' }),
    { previewsForUrls: async () => new Map() } as never,
  );
}

/**
 * #971: квитанции «Просмотрено» живут по области чтения — чтение обсуждения
 * не делает сотрудника просмотревшим ленту канала, и наоборот.
 */
describe('квитанции по областям чтения (#971)', () => {
  const feedRow = row({ id: 'post-1', threadRootId: null });
  const threadRow = row({ id: 'reply-1', threadRootId: 'root-1', seq: 6n });

  it('чтение только обсуждения: в ленте не «Просмотрено»', async () => {
    // Курсор беседы ушёл (читал тред), курсор ленты — нет.
    const members = [
      member({ userId: 'me-1' }),
      member({
        userId: 'reader',
        lastReadSeq: 9n,
        lastReadAt: T2,
        lastFeedReadSeq: 0n,
        lastFeedReadAt: null,
      }),
    ];
    const dtos = await mapper().toDtos([feedRow], { viewerId: 'me-1', members });
    expect(dtos[0]?.readBy).toEqual([]);
  });

  it('лента прочитана: в «Просмотрено» ленты есть, в ответах треда — нет', async () => {
    const members = [
      member({ userId: 'me-1' }),
      member({
        userId: 'reader',
        lastReadSeq: 9n,
        lastReadAt: T2,
        lastFeedReadSeq: 9n,
        lastFeedReadAt: T2,
      }),
    ];
    const dtos = await mapper().toDtos([feedRow, threadRow], { viewerId: 'me-1', members });
    expect(dtos[0]?.readBy.map((r) => r.id)).toEqual(['reader']);
    // Ответ треда без watermark-а треда — читателей треда нет.
    expect(dtos[1]?.readBy).toEqual([]);
  });

  it('тред прочитан: «Просмотрено» под ответом — по watermark треда', async () => {
    const members = [
      member({ userId: 'me-1' }),
      member({ userId: 'reader', lastReadSeq: 0n, lastReadAt: null }),
    ];
    const threadCursors: ThreadCursors = new Map([
      ['root-1', [{ userId: 'reader', lastReadSeq: 9n, lastReadAt: T2 }]],
    ]);
    const dtos = await mapper(threadCursors).toDtos([threadRow], { viewerId: 'me-1', members });
    expect(dtos[0]?.readBy.map((r) => r.id)).toEqual(['reader']);
  });
});
