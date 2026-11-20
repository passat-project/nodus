import { describe, expect, it } from 'vitest';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import type { MemberRow } from '../conversations/conversations.repository.js';
import type { MessageRow } from './message-row.js';
import { MessageDtoMapper } from './message-dto.mapper.js';
import { computeReadAt, computeReadBy } from './message-read-receipts.js';

type ReadAtRow = Pick<MessageRow, 'authorId' | 'seq' | 'editedAt' | 'createdAt'>;

const T0 = new Date('2026-09-24T09:00:00Z');
const T1 = new Date('2026-09-24T10:00:00Z');
const T2 = new Date('2026-09-24T11:00:00Z');
const T3 = new Date('2026-09-24T12:00:00Z');

function row(overrides: Partial<ReadAtRow> = {}): ReadAtRow {
  return { authorId: 'me-1', seq: 5n, editedAt: null, createdAt: T0, ...overrides };
}

function member(overrides: Partial<MemberRow> = {}): MemberRow {
  // Квитанции ленты (#971) по умолчанию совпадают с курсором беседы: тесты
  // #102 продолжают проверять прежнюю семантику, разделение — отдельными
  // кейсами ниже.
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

describe('computeReadAt (первый прочитавший, #102)', () => {
  it('чужое сообщение → null', () => {
    expect(computeReadAt(row({ authorId: 'peer-1' }), [member()], 'me-1')).toBeNull();
  });

  it('«Заметки» (нет других участников) → createdAt', () => {
    expect(computeReadAt(row(), [], 'me-1')).toBe('2026-09-24T09:00:00.000Z');
    expect(computeReadAt(row(), [member({ userId: 'me-1' })], 'me-1')).toBe(
      '2026-09-24T09:00:00.000Z',
    );
  });

  it('direct: собеседник прочитал (курсор >= seq) → его lastReadAt', () => {
    const members = [member({ userId: 'me-1' }), member({ lastReadSeq: 5n, lastReadAt: T1 })];
    expect(computeReadAt(row(), members, 'me-1')).toBe('2026-09-24T10:00:00.000Z');
    expect(computeReadAt(row({ seq: 6n }), members, 'me-1')).toBeNull();
  });

  it('group: никто не прочитал → null; ПЕРВЫЙ прочитал → его lastReadAt (min)', () => {
    const me = member({ userId: 'me-1' });
    const read = (id: string, at: Date) => member({ userId: id, lastReadSeq: 9n, lastReadAt: at });
    // Никто: у второго курсор не дошёл.
    const nobody = [me, member({ userId: 'a', lastReadSeq: 4n, lastReadAt: T3 })];
    expect(computeReadAt(row(), nobody, 'me-1')).toBeNull();
    // Один из троих прочитал раньше остальных — его и берём (критерий #102:
    // «Климович открывает канал → у поста сразу галочка и Прочитано 1»).
    const some = [
      me,
      read('a', T1),
      read('b', T3),
      member({ userId: 'c', lastReadSeq: 4n, lastReadAt: T3 }),
    ];
    expect(computeReadAt(row(), some, 'me-1')).toBe('2026-09-24T10:00:00.000Z');
    // Все прочитали — по-прежнему первый (min, не max).
    const all = [me, read('a', T1), read('b', T3), read('c', T2)];
    expect(computeReadAt(row(), all, 'me-1')).toBe('2026-09-24T10:00:00.000Z');
  });

  it('правка: неперечитавшие исключаются, readAt — первый перечитавший', () => {
    const me = member({ userId: 'me-1' });
    const read = (id: string, at: Date) => member({ userId: id, lastReadSeq: 9n, lastReadAt: at });
    const edited = row({ editedAt: T2 });
    // a прочитал ДО правки — исключён; b перечитал после → его момент.
    expect(computeReadAt(edited, [me, read('a', T1), read('b', T3)], 'me-1')).toBe(
      '2026-09-24T12:00:00.000Z',
    );
    // Никто не перечитал → null.
    expect(computeReadAt(edited, [me, read('a', T1)], 'me-1')).toBeNull();
  });

  it('lastReadAt=null при lastReadSeq>0 не считается прочитавшим', () => {
    const members = [member({ userId: 'me-1' }), member({ lastReadSeq: 9n, lastReadAt: null })];
    expect(computeReadAt(row(), members, 'me-1')).toBeNull();
  });
});

describe('computeReadBy (#102)', () => {
  it('чужое сообщение → пустой список (прочитавших видит только автор)', () => {
    const members = [member({ userId: 'me-1' }), member({ lastReadSeq: 9n, lastReadAt: T1 })];
    expect(computeReadBy(row({ authorId: 'peer-1' }), members, 'peer-1')).toEqual([]);
  });

  it('своё: прочитавшие по возрастанию времени, исключая автора', () => {
    const me = member({ userId: 'me-1' });
    const read = (id: string, at: Date) => member({ userId: id, lastReadSeq: 9n, lastReadAt: at });
    const members = [
      me,
      read('b', T3),
      read('a', T1),
      member({ userId: 'c', lastReadSeq: 4n, lastReadAt: T3 }),
    ];
    expect(computeReadBy(row(), members, 'me-1')).toEqual([
      { userId: 'a', lastReadAt: T1 },
      { userId: 'b', lastReadAt: T3 },
    ]);
  });

  it('правка исключает прочитавшего до перечитывания', () => {
    const me = member({ userId: 'me-1' });
    const read = (id: string, at: Date) => member({ userId: id, lastReadSeq: 9n, lastReadAt: at });
    const edited = row({ editedAt: T2 });
    expect(computeReadBy(edited, [me, read('a', T1), read('b', T3)], 'me-1')).toEqual([
      { userId: 'b', lastReadAt: T3 },
    ]);
  });
});

function stubMapper(originals: MessageRow[] = []): MessageDtoMapper {
  const messages = {
    reactionsFor: async () => [],
    attachmentsFor: async () => [],
    threadReplyCounts: async () => [],
    findByIds: async () => originals,
  };
  const pins = { pinnedIds: async () => new Set<string>() };
  const threadReads = { readCursorsFor: async () => new Map() };
  const profiles = {
    findRefs: async (ids: string[]) => ids.map((id) => ({ id, displayName: id, avatarUrl: null })),
  };
  return new MessageDtoMapper(
    messages as never,
    messages as never, // реакции: тот же мок (метод reactionsFor)
    pins as never,
    threadReads as never,
    profiles as never,
    new SignedUrlService({ STORAGE_URL_SECRET: 'test-secret-32-chars-aaaaaaaaaaaa' }),
    { previewsForUrls: async () => new Map() } as never,
  );
}

function fullRow(overrides: Partial<MessageRow> = {}): MessageRow {
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

describe('toDtos смешанной страницы (список бесед, #124)', () => {
  const members = [
    member({ conversationId: 'conv-1', userId: 'me-1' }),
    member({ conversationId: 'conv-1', userId: 'a', lastReadSeq: 5n, lastReadAt: T1 }),
    member({ conversationId: 'conv-2', userId: 'me-1' }),
    member({ conversationId: 'conv-2', userId: 'b', lastReadSeq: 0n, lastReadAt: T2 }),
  ];
  const rows = [
    fullRow({ id: 'm-1', conversationId: 'conv-1' }),
    fullRow({ id: 'm-2', conversationId: 'conv-2' }),
  ];

  it('membersByConversation: readBy по УЧАСТНИКАМ СВОЕЙ беседы', async () => {
    const dtos = await stubMapper().toDtos(rows, {
      viewerId: 'me-1',
      members,
      membersByConversation: new Map([
        ['conv-1', members.filter((m) => m.conversationId === 'conv-1')],
        ['conv-2', members.filter((m) => m.conversationId === 'conv-2')],
      ]),
    });
    expect(dtos[0]?.readBy.map((r) => r.id)).toEqual(['a']);
    // В conv-2 никто не прочитал (курсор b = 0) — прочитавших нет.
    expect(dtos[1]?.readBy).toEqual([]);
  });

  it('без карты (одна беседа в контексте) — прежняя семантика общих members', async () => {
    const dtos = await stubMapper().toDtos(rows, { viewerId: 'me-1', members });
    expect(dtos[0]?.readBy.map((r) => r.id)).toEqual(['a']);
    // Курсор a добрёл и до чужой строки — карта обязательна для смеси.
    expect(dtos[1]?.readBy.map((r) => r.id)).toEqual(['a']);
  });
});

describe('buildReplyPreview — различие надгробие/бесследно (#163)', () => {
  const members = [member({ userId: 'me-1' })];
  const replyRow = fullRow({
    id: 'r-1',
    text: 'ответ',
    replyToId: 'orig-1',
    replySnapshot: { authorId: 'peer-1', text: 'цитата', quoteText: null, attachmentKind: null },
  });

  it('оригинал — надгробие (obliterated=false): deleted=true, obliterated=false → цитата кликабельна', async () => {
    const dtos = await stubMapper([
      fullRow({ id: 'orig-1', deletedAt: T1, obliterated: false, text: '' }),
    ]).toDtos([replyRow], { viewerId: 'me-1', members });
    expect(dtos[0]?.reply).toMatchObject({ id: 'orig-1', deleted: true, obliterated: false });
  });

  it('оригинал исчез бесследно (obliterated=true): клику некуда вести', async () => {
    const dtos = await stubMapper([
      fullRow({ id: 'orig-1', deletedAt: T1, obliterated: true, text: '' }),
    ]).toDtos([replyRow], { viewerId: 'me-1', members });
    expect(dtos[0]?.reply).toMatchObject({ id: 'orig-1', deleted: true, obliterated: true });
  });

  it('оригинал из ЧУЖОЙ беседы (legacy-ссылка, #344) — не раскрывается: ни автора, ни состояния', async () => {
    const foreignRow = fullRow({
      id: 'r-2',
      text: 'ответ',
      replyToId: 'orig-x',
      replySnapshot: { authorId: null, text: '', quoteText: null, attachmentKind: null },
    });
    const dtos = await stubMapper([
      fullRow({ id: 'orig-x', conversationId: 'conv-secret', authorId: 'boss-1', text: 'тайна' }),
    ]).toDtos([foreignRow], { viewerId: 'me-1', members });
    expect(dtos[0]?.reply).toMatchObject({
      id: 'orig-x',
      author: null,
      text: '',
      deleted: true,
      obliterated: true,
    });
  });

  it('оригинала нет в выдаче вовсе (гонка) — считаем бесследным', async () => {
    const dtos = await stubMapper([]).toDtos([replyRow], { viewerId: 'me-1', members });
    expect(dtos[0]?.reply).toMatchObject({ id: 'orig-1', deleted: true, obliterated: true });
  });
});

describe('цитата-на-стикер: url подписывается при чтении (#288)', () => {
  const members = [member({ userId: 'me-1' })];
  const replyRow = fullRow({
    id: 'r-st',
    text: 'ответ',
    replyToId: 'orig-st',
    replySnapshot: {
      authorId: 'peer-1',
      text: '',
      quoteText: null,
      attachmentKind: 'sticker',
      // Несущий инвариант: замороженный снапшот хранит только fileId —
      // протухающие подписанные ссылки в нём запрещены.
      stickerFileId: 'file-st-1',
      stickerEmoji: '🙂',
      stickerMime: 'image/webp',
    },
  });

  it('stickerUrl строится подписью fileId; эмодзи/mime прокинуты', async () => {
    const dtos = await stubMapper([fullRow({ id: 'orig-st' })]).toDtos([replyRow], {
      viewerId: 'me-1',
      members,
    });
    const url = dtos[0]?.reply?.stickerUrl ?? '';
    // Подписанный адрес содержимого ИМЕННО этого файла
    expect(url).toContain('/api/v1/files/file-st-1/content');
    expect(url).toContain('sig=');
    expect(dtos[0]?.reply?.stickerEmoji).toBe('🙂');
    expect(dtos[0]?.reply?.stickerMime).toBe('image/webp');
    // Сам снапшот подписанного url не хранит
    expect(JSON.stringify(replyRow.replySnapshot)).not.toContain(url);
  });

  it('удалённый оригинал: глиф погашен (url/эмодзи/mime → null)', async () => {
    const dtos = await stubMapper([
      fullRow({ id: 'orig-st', deletedAt: T1, obliterated: true }),
    ]).toDtos([replyRow], { viewerId: 'me-1', members });
    expect(dtos[0]?.reply?.stickerUrl).toBeNull();
    expect(dtos[0]?.reply?.stickerEmoji).toBeNull();
    expect(dtos[0]?.reply?.stickerMime).toBeNull();
  });
});
