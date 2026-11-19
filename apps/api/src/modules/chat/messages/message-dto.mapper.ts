import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  chatMessageBlockSchema,
  type ChatMessage,
  type ChatMessageBlock,
  type MessageAttachment,
  type MessageReaction,
  type UserRef,
} from '@nodus/contracts';

import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { MemberRow } from '../conversations/conversations.repository.js';
import type { MessageRow } from './message-row.js';
import { MessagesRepository } from './messages.repository.js';
import { MessagesReactionsRepository, type ReactionRow } from './messages-reactions.repository.js';
import { MessagePinsRepository } from './message-pins.repository.js';
import { extractMessageUrls } from './link-extractor.js';
import { LinkPreviewService } from '../link-previews/link-preview.service.js';
import { normalizeUrl } from '../link-previews/url-normalize.js';
import { toAttachmentDto, type AttachmentDtoRow } from './message-attachment.dto.js';
import { computeReadAt, computeReadBy, type ReadCursor } from './message-read-receipts.js';
import { ThreadReadsRepository } from './thread-reads.repository.js';
import {
  buildForwardedFrom,
  buildReplyPreview,
  fallbackRef,
  type ReplySnapshotValue,
} from './message-reply-preview.js';

/** userId упоминаний из JSONB-колонки (снапшот отправки, #100). */
export function readMentionedUserIds(row: MessageRow): string[] {
  const raw = (row.mentionedUserIds ?? null) as string[] | null;
  return Array.isArray(raw) ? raw : [];
}

/** Накопительное множество упомянутых за историю сообщения (#239). */
export function readEverMentionedUserIds(row: MessageRow): string[] {
  const raw = (row.everMentionedUserIds ?? null) as string[] | null;
  return Array.isArray(raw) ? raw : [];
}

export interface MessageDtoContext {
  viewerId: string;
  /** Участники беседы сообщения (курсоры прочтения для readAt). */
  members: MemberRow[];
  /** Смешанная страница (список бесед: lastMessage разных бесед одним
   *  toDtos, #124): курсоры прочтения берутся ПО СВОЕЙ беседе; нет записи —
   *  fallback на members. */
  membersByConversation?: ReadonlyMap<string, MemberRow[]>;
}

/** Курсоры чтения строки: ответ треда — watermark треда (#971), сообщение
 *  ленты — курсор ЛЕНТЫ участников беседы (чтение обсуждения его не двигает). */
function readCursorsFor(
  row: MessageRow,
  ctx: MessageDtoContext,
  threadReaders: ReadonlyMap<string, readonly ReadCursor[]>,
  feedByConversation: Map<string, ReadCursor[]>,
): readonly ReadCursor[] {
  if (row.threadRootId !== null) return threadReaders.get(row.threadRootId) ?? [];
  const cached = feedByConversation.get(row.conversationId);
  if (cached) return cached;
  const cursors = membersFor(ctx, row.conversationId).map((m) => ({
    userId: m.userId,
    lastReadSeq: m.lastFeedReadSeq,
    lastReadAt: m.lastFeedReadAt,
  }));
  feedByConversation.set(row.conversationId, cursors);
  return cursors;
}

/** Курсоры прочтения строки: своя беседа в смешанной странице, иначе members. */
function membersFor(ctx: MessageDtoContext, conversationId: string): MemberRow[] {
  return ctx.membersByConversation?.get(conversationId) ?? ctx.members;
}

/**
 * Сборка ChatMessage DTO из сырых строк: гидратация авторов через read-порт
 * (ADR-0012), readAt по курсорам участников, реакции/вложения/счётчики треда
 * батчами. Надгробие: text='', вложения/реакции/цитата пусты (мок-семантика).
 */
@Injectable()
export class MessageDtoMapper {
  private readonly logger = new Logger(MessageDtoMapper.name);

  constructor(
    private readonly messages: MessagesRepository,
    private readonly reactions: MessagesReactionsRepository,
    private readonly pins: MessagePinsRepository,
    private readonly threadReads: ThreadReadsRepository,
    @Inject(USER_PROFILE_READER) private readonly userProfiles: UserProfileReader,
    private readonly signedUrls: SignedUrlService,
    private readonly linkPreviews: LinkPreviewService,
  ) {}

  async toDtos(rows: MessageRow[], ctx: MessageDtoContext): Promise<ChatMessage[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const replyIds = [...new Set(rows.flatMap((r) => (r.replyToId ? [r.replyToId] : [])))];
    // Квитанции (#971): ответы тредов считаются по watermark треда (батч одним
    // запросом), сообщения ленты — по курсору ленты участников беседы.
    const threadRootIds = [
      ...new Set(rows.flatMap((r) => (r.threadRootId ? [r.threadRootId] : []))),
    ];
    const threadReaders = await this.threadReads.readCursorsFor(threadRootIds);
    const feedByConversation = new Map<string, ReadCursor[]>();
    const cursorsFor = (row: MessageRow): readonly ReadCursor[] =>
      readCursorsFor(row, ctx, threadReaders, feedByConversation);
    // Прочитавшие своих сообщений (#102): батч в общий loadRefs.
    const readByRows = rows.map((row) => ({
      row,
      readers: computeReadBy(row, cursorsFor(row), ctx.viewerId),
    }));
    const readerIds = new Set(readByRows.flatMap(({ readers }) => readers.map((r) => r.userId)));
    // Реакции читаются ДО refs: их userId попадают в общий батч профилей
    // (тултип «кто поставил» — users в DTO, вердикт 27.09).
    const reactions = await this.reactions.reactionsFor(ids);
    const reactionUserIds = new Set(reactions.map((r) => r.userId));
    const [refs, attachments, threadCounts, pinnedIds, replyOriginals] = await Promise.all([
      this.loadRefs(rows, readerIds, reactionUserIds),
      this.messages.attachmentsFor(ids),
      this.messages.threadReplyCounts(rows.filter((r) => r.threadRootId === null).map((r) => r.id)),
      this.pins.pinnedIds(ids),
      replyIds.length > 0 ? this.messages.findByIds(replyIds) : Promise.resolve([]),
    ]);

    const reactionsByMessage = groupBy(reactions, (r) => r.messageId);
    const attachmentsByMessage = groupBy(attachments, (a) => a.messageId);
    const threadCountByRoot = new Map(threadCounts.map((t) => [t.rootId, t.count]));
    const originalById = new Map(replyOriginals.map((o) => [o.id, o]));

    // Превью ПЕРВОЙ ссылки сообщения (#212): карточка только первой (канон
    // TG/Slack), батч кэша на страницу; надгробие карточки не несёт.
    const firstUrls = rows.map((row) => extractMessageUrls(row.text)[0] ?? null);
    const previews = await this.linkPreviews.previewsForUrls(
      firstUrls.filter((url): url is string => url !== null),
    );

    return rows.map((row, index) => {
      const tombstone = row.deletedAt !== null;
      const readers = readByRows[index]?.readers ?? [];
      return {
        id: row.id,
        conversationId: row.conversationId,
        seq: Number(row.seq),
        clientMessageId: row.clientMessageId,
        author: refs.get(row.authorId) ?? fallbackRef(row.authorId),
        text: tombstone ? '' : row.text,
        replyToId: row.replyToId,
        reply: tombstone ? null : buildReplyPreview(row, refs, originalById, this.signedUrls),
        threadRootId: row.threadRootId,
        threadRepliesCount: row.threadRootId === null ? (threadCountByRoot.get(row.id) ?? 0) : 0,
        reactions: tombstone
          ? []
          : groupReactions(reactionsByMessage.get(row.id) ?? [], ctx.viewerId, refs),
        attachments: tombstone
          ? []
          : (attachmentsByMessage.get(row.id) ?? []).map((a): MessageAttachment =>
              toAttachmentDto(a, this.signedUrls),
            ),
        editedAt: row.editedAt?.toISOString() ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        pinned: pinnedIds.has(row.id),
        forwardedFrom: buildForwardedFrom(row, refs),
        readAt: computeReadAt(row, cursorsFor(row), ctx.viewerId),
        readBy: readers.map(
          (reader): UserRef => refs.get(reader.userId) ?? fallbackRef(reader.userId),
        ),
        urgent: row.urgent,
        mentionedUserIds: tombstone ? [] : readMentionedUserIds(row),
        kind: row.kind as ChatMessage['kind'],
        block: tombstone ? null : this.blockOf(row),
        linkPreview: tombstone
          ? null
          : ((firstUrls[index] ? previews.get(normalizeUrl(firstUrls[index]!) ?? '') : null) ??
            null),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async toDto(row: MessageRow, ctx: MessageDtoContext): Promise<ChatMessage> {
    const [dto] = await this.toDtos([row], ctx);
    if (!dto) throw new Error('toDto: empty page');
    return dto;
  }

  /**
   * DTO ТОЛЬКО ЧТО вставленного сообщения (payload события message_sent,
   * раунд 3 — «буря рефечей»): живые клиенты применяют его в кэш локально по
   * seq. Собирается из данных транзакции отправки БЕЗ лишних запросов:
   * реакции/закрепы/прочитавшие у новой строки невозможны (пусты), вложения
   * переданы уже привязанными (claimAttachments). replyOriginal — строка
   * оригинала цитаты, уже загруженная отправкой (null — оригинал утрачен).
   * Профили читаются по соединению транзакции (tx) — иначе параллельные
   * отправки голодают пул соединений (repro chat-reliability).
   */
  async toFreshDto(
    row: MessageRow,
    ctx: {
      viewerId: string;
      members: MemberRow[];
      replyOriginal: MessageRow | null;
      attachments: AttachmentDtoRow[];
      tx?: TransactionClient;
    },
  ): Promise<ChatMessage> {
    const ids = new Set<string>([row.authorId]);
    const snapshot = (row.replySnapshot ?? null) as ReplySnapshotValue | null;
    if (snapshot?.authorId) ids.add(snapshot.authorId);
    if (row.fwdAuthorId) ids.add(row.fwdAuthorId);
    const refs = new Map<string, UserRef>();
    for (const ref of await this.userProfiles.findRefs([...ids], ctx.tx)) refs.set(ref.id, ref);

    const originalById = row.replyToId
      ? new Map(ctx.replyOriginal ? [[ctx.replyOriginal.id, ctx.replyOriginal]] : [])
      : new Map<string, MessageRow>();
    return {
      id: row.id,
      conversationId: row.conversationId,
      seq: Number(row.seq),
      clientMessageId: row.clientMessageId,
      author: refs.get(row.authorId) ?? fallbackRef(row.authorId),
      text: row.text,
      replyToId: row.replyToId,
      reply: buildReplyPreview(row, refs, originalById, this.signedUrls),
      threadRootId: row.threadRootId,
      threadRepliesCount: 0,
      reactions: [],
      attachments: ctx.attachments.map((a) => toAttachmentDto(a, this.signedUrls)),
      editedAt: null,
      deletedAt: null,
      pinned: false,
      forwardedFrom: buildForwardedFrom(row, refs),
      readAt: computeReadAt(row, ctx.members, ctx.viewerId),
      readBy: [],
      urgent: row.urgent,
      mentionedUserIds: readMentionedUserIds(row),
      kind: row.kind as ChatMessage['kind'],
      block: this.blockOf(row),
      // Свежая отправка: превью ещё нет (конвейер фоновый, #212) — клиент
      // рисует скелетон по наличию URL и патчит по chat.link_preview_ready.
      linkPreview: null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Блок сообщения по виду (#380): payload не разобрался — не роняем ленту,
   *  отдаём обычный пузырь и пишем warn (битый payload виден в логах). */
  private blockOf(row: MessageRow): ChatMessageBlock | null {
    if (row.kind === 'text' || row.payload === null) return null;
    const parsed = chatMessageBlockSchema.safeParse(row.payload);
    if (!parsed.success) {
      this.logger.warn(
        { messageId: row.id, kind: row.kind },
        'chat: payload сообщения не разобрался — блок не отдаём',
      );
      return null;
    }
    return parsed.data;
  }

  private async loadRefs(
    rows: MessageRow[],
    readerIds: Set<string> = new Set(),
    extraIds: Set<string> = new Set(),
  ): Promise<Map<string, UserRef>> {
    const ids = new Set<string>([...readerIds, ...extraIds]);
    for (const row of rows) {
      ids.add(row.authorId);
      const snapshot = (row.replySnapshot ?? null) as ReplySnapshotValue | null;
      if (snapshot?.authorId) ids.add(snapshot.authorId);
      if (row.fwdAuthorId) ids.add(row.fwdAuthorId);
    }
    const refs = new Map<string, UserRef>();
    const loaded = await this.userProfiles.findRefs([...ids]);
    for (const ref of loaded) refs.set(ref.id, ref);
    return refs;
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(key(item)) ?? [];
    list.push(item);
    map.set(key(item), list);
  }
  return map;
}

function groupReactions(
  rows: ReactionRow[],
  viewerId: string,
  refs: Map<string, UserRef>,
): MessageReaction[] {
  const byEmoji = new Map<string, { users: UserRef[]; mine: boolean }>();
  for (const { emoji, userId } of rows) {
    const agg = byEmoji.get(emoji) ?? { users: [], mine: false };
    agg.users.push(refs.get(userId) ?? fallbackRef(userId));
    agg.mine = agg.mine || userId === viewerId;
    byEmoji.set(emoji, agg);
  }
  return [...byEmoji.entries()]
    .map(([emoji, { users, mine }]) => ({ emoji, count: users.length, mine, users }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}
