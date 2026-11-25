import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';

/**
 * Источники «Избранного» (#211 Ф3, реф Telegram Saved): агрегаты панели
 * источников по закладкам владельца — чаты-источники и сводка категорий +
 * псевдоисточник «Записи». Только чтение, приватность — те же инварианты,
 * что у списка (беседы-участия, живые оригиналы). Выделено из
 * FavoritesRepository (I5: одна ответственность — CRUD закладок отдельно).
 */
@Injectable()
export class FavoriteSourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Источник агрегата «Избранного по чатам» (строка панели источников). */
  async sourceRows(
    userId: string,
  ): Promise<{ id: string; type: string; title: string | null; last: Date; count: number }[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; type: string; title: string | null; last: Date; count: bigint }[]
    >(Prisma.sql`
      SELECT m.conversation_id AS id, c.type, c.title,
             MAX(f.created_at) AS last, COUNT(*) AS count
      FROM favorites f
      JOIN messages m ON m.id = f.message_id
      JOIN conversations c ON c.id = m.conversation_id
      WHERE f.user_id = ${userId}::uuid
        AND m.deleted_at IS NULL AND NOT m.obliterated
        AND EXISTS (
          SELECT 1 FROM conversation_members cm
          WHERE cm.conversation_id = m.conversation_id AND cm.user_id = ${userId}::uuid
        )
      GROUP BY m.conversation_id, c.type, c.title
      ORDER BY MAX(f.created_at) DESC
    `);
    return rows.map((row) => ({ ...row, count: Number(row.count) }));
  }

  /**
   * Сводка «Избранного» пользователя: счётчики категорий ПО КАРТОЧКАМ звёзд
   * (вложения живых оригиналов с mime-классификацией витрины + ссылки
   * message_links — НЕ stats беседы «Избранное»: избранное живёт в чужих
   * беседах, ревизия 05.10) и псевдоисточник «Записи». Одним SQL со scalar
   * subqueries — сводка панели, не горячий путь.
   */
  async sourcesSummary(userId: string): Promise<{
    counts: {
      image: number;
      video: number;
      audio: number;
      document: number;
      link: number;
    };
    notesCount: number;
    notesLast: Date | null;
  }> {
    const alive = Prisma.sql`m.deleted_at IS NULL AND NOT m.obliterated`;
    const membership = Prisma.sql`EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = m.conversation_id AND cm.user_id = ${userId}::uuid
    )`;
    const favoriteAttachments = (filter: Prisma.Sql) => Prisma.sql`
      (SELECT COUNT(*) FROM favorites f
         JOIN messages m ON m.id = f.message_id
         JOIN message_attachments a ON a.message_id = m.id
         WHERE f.user_id = ${userId}::uuid AND ${alive} AND ${membership} AND ${filter}
      )`;
    const rows = await this.prisma.$queryRaw<
      {
        image_count: bigint;
        video_count: bigint;
        audio_count: bigint;
        document_count: bigint;
        link_count: bigint;
        notes_count: bigint;
        notes_last: Date | null;
      }[]
    >(Prisma.sql`
      SELECT
        ${favoriteAttachments(Prisma.sql`a.kind = 'image'`)} AS image_count,
        ${favoriteAttachments(
          Prisma.sql`(a.kind = 'video' OR (a.kind = 'file' AND a.mime LIKE 'video/%'))`,
        )} AS video_count,
        ${favoriteAttachments(Prisma.sql`a.kind = 'file' AND a.mime LIKE 'audio/%'`)} AS audio_count,
        ${favoriteAttachments(
          Prisma.sql`a.kind = 'file' AND a.mime NOT LIKE 'video/%' AND a.mime NOT LIKE 'audio/%'`,
        )} AS document_count,
        (SELECT COUNT(*) FROM favorites f
           JOIN messages m ON m.id = f.message_id
           JOIN message_links l ON l.message_id = m.id
           WHERE f.user_id = ${userId}::uuid AND ${alive} AND ${membership}
        ) AS link_count,
        (SELECT COUNT(*) FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE c.type = 'direct' AND c.user_min = ${userId}::uuid AND c.user_max = ${userId}::uuid
             AND m.author_id = ${userId}::uuid AND m.deleted_at IS NULL AND NOT m.obliterated
        ) AS notes_count,
        (SELECT MAX(m.created_at) FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE c.type = 'direct' AND c.user_min = ${userId}::uuid AND c.user_max = ${userId}::uuid
             AND m.author_id = ${userId}::uuid AND m.deleted_at IS NULL AND NOT m.obliterated
        ) AS notes_last
    `);
    const row = rows[0];
    return {
      counts: {
        image: Number(row?.image_count ?? 0),
        video: Number(row?.video_count ?? 0),
        audio: Number(row?.audio_count ?? 0),
        document: Number(row?.document_count ?? 0),
        link: Number(row?.link_count ?? 0),
      },
      notesCount: Number(row?.notes_count ?? 0),
      notesLast: row?.notes_last ?? null,
    };
  }
}
