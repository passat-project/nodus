import { Injectable } from '@nestjs/common';
import type { VaultCounts } from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { AttachmentDtoRow } from '../messages/message-attachment.dto.js';
import type { VaultKind } from './vault-kinds.js';

/** Витрина беседы (#211): списки вложений/ссылок + денормализованные
 *  счётчики (conversation_vault_stats) и проекция ссылок (message_links).
 *
 *  Производительность (модель Telegram getSearchCounters / Битрикс24):
 *  счётчики всей беседы — чтение O(1) по PK stats-строки (Δ-обслуживание
 *  в транзакциях состава — см. messages.service/message-actions.service);
 *  списки — keyset (seq DESC, положение в сообщении ASC) по индексам
 *  messages(conversation_id, seq) и message_links(conversation_id).
 *  Счётчики скоупа треда считаются на лету (объём треда мал; денормализацию
 *  per-thread не плодим). Инвариант stats == COUNT(живых) проверяется
 *  integration-тестами; полный пересчёт — миграция vault_backfill. */

/** Строка вложения витрины: DTO-поля + контекст сообщения-источника. */
export interface VaultAttachmentRow extends AttachmentDtoRow {
  sortOrder: number;
  messageId: string;
  threadRootId: string | null;
  seq: bigint;
  authorId: string;
  messageCreatedAt: Date;
}

/** Строка ссылки витрины (message_links + seq сообщения для keyset). */
export interface VaultLinkRow {
  messageId: string;
  conversationId: string;
  threadRootId: string | null;
  position: number;
  url: string;
  authorId: string;
  seq: bigint;
  messageCreatedAt: Date;
}

const ATTACHMENT_COLS = Prisma.sql`
  a.id, a.file_id AS "fileId", a.name, a.size, a.mime, a.kind,
  a.width, a.height, a.duration_ms AS "durationMs", a.thumb_file_id AS "thumbFileId",
  a.sort_order AS "sortOrder",
  m.id AS "messageId", m.thread_root_id AS "threadRootId", m.seq,
  m.author_id AS "authorId", m.created_at AS "messageCreatedAt"
`;

const LINK_COLS = Prisma.sql`
  l.message_id AS "messageId", l.conversation_id AS "conversationId",
  l.thread_root_id AS "threadRootId", l.position, l.url, l.author_id AS "authorId",
  m.seq, m.created_at AS "messageCreatedAt"
`;

/** Живость сообщения-хоста (надгробия/бесследие в витрине не показываются). */

/**
 * Витрина беседы — ЧТЕНИЕ: списки вложений/ссылок и счётчики. Обслуживание
 * проекции ссылок и stats в транзакциях состава — vault-write.repository
 * (I5: разнесено по ответственности); классификация — vault-kinds.
 */
@Injectable()
export class VaultRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ===== Чтение: списки =====

  /**
   * Страница вложений одной категории витрины: новые сверху, keyset
   * (seq DESC, sort_order ASC); hasMore по limit+1. Видео/аудио — файлы
   * с соответствующим mime (классификация vaultKindOf).
   */
  async listAttachments(
    conversationId: string,
    opts: { kind: VaultKind; limit: number; threadRootId: string | null },
    cursor: { s: bigint; o: number } | null,
  ): Promise<{ rows: VaultAttachmentRow[]; hasMore: boolean }> {
    const beforeSeq = cursor ? cursor.s.toString() : null;
    const beforeOrder = cursor ? cursor.o : 0;
    const thread = opts.threadRootId;
    const kindFilter =
      opts.kind === 'image'
        ? Prisma.sql`a.kind = 'image'`
        : opts.kind === 'video'
          ? Prisma.sql`(a.kind = 'video' OR (a.kind = 'file' AND a.mime LIKE 'video/%'))`
          : opts.kind === 'audio'
            ? Prisma.sql`a.kind = 'file' AND a.mime LIKE 'audio/%'`
            : Prisma.sql`a.kind = 'file' AND a.mime NOT LIKE 'video/%' AND a.mime NOT LIKE 'audio/%'`;
    const rows = await this.prisma.$queryRaw<VaultAttachmentRow[]>(Prisma.sql`
      SELECT ${ATTACHMENT_COLS} FROM message_attachments a
      JOIN messages m ON m.id = a.message_id
      WHERE m.conversation_id = ${conversationId}::uuid
        AND ${kindFilter}
        AND m.deleted_at IS NULL AND NOT m.obliterated
        AND (${thread === null} OR m.thread_root_id = ${thread ?? '00000000-0000-0000-0000-000000000000'}::uuid
             OR m.id = ${thread ?? '00000000-0000-0000-0000-000000000000'}::uuid)
        AND (${cursor === null}
             OR m.seq < ${beforeSeq ?? '0'}::bigint
             OR (m.seq = ${beforeSeq ?? '0'}::bigint AND a.sort_order > ${beforeOrder}::int))
      ORDER BY m.seq DESC, a.sort_order ASC
      LIMIT ${opts.limit + 1}
    `);
    const hasMore = rows.length > opts.limit;
    return { rows: hasMore ? rows.slice(0, opts.limit) : rows, hasMore };
  }

  /** Страница ссылок: новые сверху, keyset (seq DESC, position ASC). */
  async listLinks(
    conversationId: string,
    opts: { limit: number; threadRootId: string | null },
    cursor: { s: bigint; o: number } | null,
  ): Promise<{ rows: VaultLinkRow[]; hasMore: boolean }> {
    const beforeSeq = cursor ? cursor.s.toString() : null;
    const beforePosition = cursor ? cursor.o : 0;
    const thread = opts.threadRootId;
    const rows = await this.prisma.$queryRaw<VaultLinkRow[]>(Prisma.sql`
      SELECT ${LINK_COLS} FROM message_links l
      JOIN messages m ON m.id = l.message_id
      WHERE l.conversation_id = ${conversationId}::uuid
        AND m.deleted_at IS NULL AND NOT m.obliterated
        AND (${thread === null} OR l.thread_root_id = ${thread ?? '00000000-0000-0000-0000-000000000000'}::uuid
             OR l.message_id = ${thread ?? '00000000-0000-0000-0000-000000000000'}::uuid)
        AND (${cursor === null}
             OR m.seq < ${beforeSeq ?? '0'}::bigint
             OR (m.seq = ${beforeSeq ?? '0'}::bigint AND l.position > ${beforePosition}::int))
      ORDER BY m.seq DESC, l.position ASC
      LIMIT ${opts.limit + 1}
    `);
    const hasMore = rows.length > opts.limit;
    return { rows: hasMore ? rows.slice(0, opts.limit) : rows, hasMore };
  }

  // ===== Чтение: счётчики =====

  /** Счётчики всей беседы — O(1) из денормализованной stats-строки. */
  async conversationCounts(conversationId: string): Promise<VaultCounts> {
    const rows = await this.prisma.$queryRaw<
      {
        image_count: bigint;
        video_count: bigint;
        audio_count: bigint;
        document_count: bigint;
        link_count: bigint;
      }[]
    >(Prisma.sql`
      SELECT COALESCE(image_count, 0) AS image_count,
             COALESCE(video_count, 0) AS video_count,
             COALESCE(audio_count, 0) AS audio_count,
             COALESCE(document_count, 0) AS document_count,
             COALESCE(link_count, 0) AS link_count
      FROM conversation_vault_stats WHERE conversation_id = ${conversationId}::uuid
    `);
    return {
      image: Number(rows[0]?.image_count ?? 0),
      video: Number(rows[0]?.video_count ?? 0),
      audio: Number(rows[0]?.audio_count ?? 0),
      document: Number(rows[0]?.document_count ?? 0),
      link: Number(rows[0]?.link_count ?? 0),
    };
  }

  /**
   * Счётчики скоупа треда — на лету (объём треда мал; per-thread
   * денормализацию не плодим). Вложения и ссылки — join живых сообщений
   * треда (defense-in-depth: выдача не зависит от чистки проекции).
   */
  async threadCounts(conversationId: string, threadRootId: string): Promise<VaultCounts> {
    const threadScope = Prisma.sql`m.thread_root_id = ${threadRootId}::uuid OR m.id = ${threadRootId}::uuid`;
    const rows = await this.prisma.$queryRaw<
      {
        image_count: bigint;
        video_count: bigint;
        audio_count: bigint;
        document_count: bigint;
        link_count: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM message_attachments a
          JOIN messages m ON m.id = a.message_id
          WHERE m.conversation_id = ${conversationId}::uuid
            AND (${threadScope})
            AND m.deleted_at IS NULL AND NOT m.obliterated AND a.kind = 'image') AS image_count,
        (SELECT COUNT(*) FROM message_attachments a
          JOIN messages m ON m.id = a.message_id
          WHERE m.conversation_id = ${conversationId}::uuid
            AND (${threadScope})
            AND m.deleted_at IS NULL AND NOT m.obliterated
            AND (a.kind = 'video' OR (a.kind = 'file' AND a.mime LIKE 'video/%'))) AS video_count,
        (SELECT COUNT(*) FROM message_attachments a
          JOIN messages m ON m.id = a.message_id
          WHERE m.conversation_id = ${conversationId}::uuid
            AND (${threadScope})
            AND m.deleted_at IS NULL AND NOT m.obliterated
            AND a.kind = 'file' AND a.mime LIKE 'audio/%') AS audio_count,
        (SELECT COUNT(*) FROM message_attachments a
          JOIN messages m ON m.id = a.message_id
          WHERE m.conversation_id = ${conversationId}::uuid
            AND (${threadScope})
            AND m.deleted_at IS NULL AND NOT m.obliterated AND a.kind = 'file'
            AND a.mime NOT LIKE 'video/%' AND a.mime NOT LIKE 'audio/%') AS document_count,
        (SELECT COUNT(*) FROM message_links l
          JOIN messages m ON m.id = l.message_id
          WHERE l.conversation_id = ${conversationId}::uuid
            AND (l.thread_root_id = ${threadRootId}::uuid OR l.message_id = ${threadRootId}::uuid)
            AND m.deleted_at IS NULL AND NOT m.obliterated) AS link_count
    `);
    return {
      image: Number(rows[0]?.image_count ?? 0),
      video: Number(rows[0]?.video_count ?? 0),
      audio: Number(rows[0]?.audio_count ?? 0),
      document: Number(rows[0]?.document_count ?? 0),
      link: Number(rows[0]?.link_count ?? 0),
    };
  }

  /** URL сообщения в порядке появления (конвейер превью #212: какие адреса
   *  греть; проекция уже посчитана транзакцией отправки). */
  async urlsOfMessage(messageId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ url: string }[]>(Prisma.sql`
      SELECT url FROM message_links WHERE message_id = ${messageId}::uuid ORDER BY position
    `);
    return rows.map((row) => row.url);
  }
}
