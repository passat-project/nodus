import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  ACTIVITY_EXPR,
  LIST_SELECT,
  LIST_SELECT_AS_READER,
  UNREAD_COUNT_EXPR,
  type ConversationListCursor,
  type ConversationListRow,
} from './conversations-list.select.js';

export interface MemberRow {
  conversationId: string;
  userId: string;
  role: string;
  lastReadSeq: bigint;
  lastReadAt: Date | null;
  joinedAt: Date;
  pinned: boolean;
  muted: boolean;
  snoozed: boolean;
  hidden: boolean;
}

/** Сумма непрочитанных по вкладкам (unread-summary): не пагинирована. */
export interface UnreadSummaryRow {
  chats: number;
  entities: number;
  total: number;
}

interface ListOpts {
  limit: number;
  cursor?: ConversationListCursor;
  searchTitle?: string;
  searchUserIds?: string[];
  /** Вкладка мессенджера (#252): chats — люди и каналы, entities — чаты
   *  задач и писем; all — без фильтра (пикеры, пересылка). */
  scope?: 'all' | 'chats' | 'entities';
}

/**
 * Репозиторий агрегата Conversation — ЧТЕНИЕ: список бесед одним запросом
 * (LATERAL для lastMessage и unread — индекс (conversation_id, seq)
 * обслуживает оба; масштаб 200–300 сотрудников не требует
 * денормализованных счётчиков, watermark last_read_seq каноничен), атрибуты
 * беседы, участие и состав. Запись разнесена по ответственности (I5):
 * беседа — conversations-write.repository, участие — conversation-
 * members.repository, черновики — conversation-drafts.repository.
 */
@Injectable()
export class ConversationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: TransactionClient): PrismaService | TransactionClient {
    return tx ?? this.prisma;
  }

  /** Страница бесед пользователя (hidden исключены; hasMore = limit+1). */
  async listForUser(userId: string, opts: ListOpts): Promise<ConversationListRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`cm.user_id = ${userId}::uuid`,
      Prisma.sql`cm.hidden = false`,
    ];
    if (opts.searchTitle !== undefined) {
      const like = `%${opts.searchTitle}%`;
      const searchUserIds = opts.searchUserIds ?? [];
      conditions.push(Prisma.sql`(
        c.title ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM conversation_members sm
          WHERE sm.conversation_id = c.id
            AND sm.user_id = ANY(${searchUserIds}::uuid[])
        )
      )`);
    }
    if (opts.scope === 'entities') {
      conditions.push(Prisma.sql`c.type IN ('task', 'letter')`);
    } else if (opts.scope === 'chats') {
      conditions.push(Prisma.sql`c.type NOT IN ('task', 'letter')`);
    }
    // Ось сортировки = выдаваемая last_activity_at (#215: «Избранное» живёт
    // и звёздами) — порядок/курсор совпадают с порядком клиента.
    const activity = ACTIVITY_EXPR(userId);
    if (opts.cursor) {
      // Keyset под ORDER BY activity DESC NULLS LAST, id DESC: беседы без
      // активности стоят в хвосте и идут ПОСЛЕ любого непустого курсора —
      // NULL-ветка явная (сентинел-сравнение строк их терял, ревью #317).
      const at = opts.cursor.at ?? null;
      conditions.push(
        at === null
          ? Prisma.sql`(${activity} IS NULL AND c.id < ${opts.cursor.id}::uuid)`
          : Prisma.sql`(
              ${activity} IS NULL
              OR (${activity}, c.id) < (${at}::timestamptz, ${opts.cursor.id}::uuid)
            )`,
      );
    }
    const where = Prisma.join(conditions, ' AND ');
    const rows = await this.prisma.$queryRaw<ConversationListRow[]>(Prisma.sql`
      ${LIST_SELECT(userId)}
      WHERE ${where}
      ORDER BY ${activity} DESC NULLS LAST, c.id DESC
      LIMIT ${opts.limit + 1}
    `);
    return rows;
  }

  /**
   * Сводка непрочитанных по вкладкам мессенджера: сумма `unread_count` по
   * ВСЕМ беседам пользователя (список пагинирован — сумма первой страницы
   * врёт). Предикат непрочитанного — общий с LIST_SELECT (UNREAD_COUNT_EXPR),
   * поэтому треды каналов и правленные сообщения считаются одинаково.
   * Скрытые и «посмотреть позже» беседы не входят: счётчик по ним скрыт и в
   * списке (строка сообщает о новом сообщении только после снятия snooze).
   */
  async unreadSummaryForUser(userId: string): Promise<UnreadSummaryRow> {
    const rows = await this.prisma.$queryRaw<UnreadSummaryRow[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(u.unread) FILTER (WHERE c.type NOT IN ('task', 'letter')), 0)::int AS chats,
        COALESCE(SUM(u.unread) FILTER (WHERE c.type IN ('task', 'letter')), 0)::int AS entities,
        COALESCE(SUM(u.unread), 0)::int AS total
      FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      CROSS JOIN LATERAL (SELECT ${UNREAD_COUNT_EXPR(userId)} AS unread) u
      WHERE cm.user_id = ${userId}::uuid
        AND cm.hidden = false
        AND cm.snoozed = false
    `);
    return rows[0] ?? { chats: 0, entities: 0, total: 0 };
  }

  /** Одна беседа в форме строки списка (ответ PATCH/создания; null — не член). */
  async findListItem(conversationId: string, userId: string): Promise<ConversationListRow | null> {
    const rows = await this.prisma.$queryRaw<ConversationListRow[]>(Prisma.sql`
      ${LIST_SELECT(userId)}
      WHERE cm.user_id = ${userId}::uuid AND cm.conversation_id = ${conversationId}::uuid
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /** Строка беседы для читателя без членства (#433): решающий видит чат
   *  задачи read-only, без непрочитанных, черновика и закрепления. */
  async findListItemAsReader(
    conversationId: string,
    userId: string,
  ): Promise<ConversationListRow | null> {
    const rows = await this.prisma.$queryRaw<ConversationListRow[]>(
      LIST_SELECT_AS_READER(userId, conversationId),
    );
    return rows[0] ?? null;
  }

  /** Задача беседы (#433): по ней проверяется «решающий ли зритель». */
  async findTaskId(conversationId: string): Promise<string | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { taskId: true },
    });
    return row?.taskId ?? null;
  }

  async findTypeAndPermissions(
    conversationId: string,
    tx?: TransactionClient,
  ): Promise<{
    id: string;
    type: string;
    permissions: Prisma.JsonValue;
    projectId: string | null;
  } | null> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<
      {
        id: string;
        type: string;
        permissions: Prisma.JsonValue;
        project_id: string | null;
      }[]
    >(Prisma.sql`
      SELECT id, type, permissions, project_id FROM conversations
      WHERE id = ${conversationId}::uuid LIMIT 1
    `);
    const row = rows[0];
    return row ? { ...row, projectId: row.project_id } : null;
  }

  /** Признак беседы «Избранное» пользователя (direct с собой: user_min =
   *  user_max = userId, #171) — звезда внутри запрещена и сервером. */
  async isNotesConversation(
    conversationId: string,
    userId: string,
    tx?: TransactionClient,
  ): Promise<boolean> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<{ one: boolean }[]>(Prisma.sql`
      SELECT (type = 'direct' AND user_min = ${userId}::uuid AND user_max = ${userId}::uuid) AS one
      FROM conversations WHERE id = ${conversationId}::uuid LIMIT 1
    `);
    return rows[0]?.one === true;
  }

  /** Последний seq беседы — потолок клампа квитанций просмотров (#102 р.2). */
  async findLastSeq(conversationId: string, tx?: TransactionClient): Promise<bigint | null> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<{ last_seq: bigint }[]>(Prisma.sql`
      SELECT last_seq FROM conversations WHERE id = ${conversationId}::uuid LIMIT 1
    `);
    return rows[0]?.last_seq ?? null;
  }

  /** Участие пользователя (null — не член/беседы нет: одинаково, чтобы не палить). */
  async findMembership(
    conversationId: string,
    userId: string,
    tx?: TransactionClient,
  ): Promise<MemberRow | null> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<MemberRow[]>(Prisma.sql`
      SELECT conversation_id AS "conversationId", user_id AS "userId", role,
             last_read_seq AS "lastReadSeq", last_read_at as "lastReadAt",
             joined_at as "joinedAt", pinned, muted, snoozed, hidden
      FROM conversation_members
      WHERE conversation_id = ${conversationId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /** Число участников беседы (лимит «важного сообщения», #100). */
  async countMembers(conversationId: string, tx?: TransactionClient): Promise<number> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*) AS count FROM conversation_members
      WHERE conversation_id = ${conversationId}::uuid
    `);
    return Number(rows[0]?.count ?? 0);
  }

  /** Участники бесед(ы) — membersPreview, курсоры прочтения, роли. */
  async listMembers(conversationIds: string[], tx?: TransactionClient): Promise<MemberRow[]> {
    const client = this.client(tx);
    if (conversationIds.length === 0) return [];
    return client.$queryRaw<MemberRow[]>(Prisma.sql`
      SELECT conversation_id AS "conversationId", user_id AS "userId", role,
             last_read_seq AS "lastReadSeq", last_read_at as "lastReadAt",
             joined_at as "joinedAt", pinned, muted, snoozed, hidden
      FROM conversation_members
      WHERE conversation_id = ANY(${conversationIds}::uuid[])
      ORDER BY joined_at ASC, user_id ASC
    `);
  }

  /** Страница участников (#186): владелец → модераторы → участники, внутри
   *  яруса — по времени входа; keyset-курсор (rank, joined_at, user_id).
   *  searchUserIds — фильтр поиска по имени (сервис резолвит через порт). */
  async listMembersPage(
    conversationId: string,
    opts: {
      limit: number;
      cursor?: { rank: number; joinedAt: string; userId: string };
      searchUserIds?: string[];
    },
    tx?: TransactionClient,
  ): Promise<Array<{ userId: string; role: string; joinedAt: Date }>> {
    const client = this.client(tx);
    const conditions: Prisma.Sql[] = [Prisma.sql`conversation_id = ${conversationId}::uuid`];
    if (opts.searchUserIds !== undefined) {
      conditions.push(Prisma.sql`user_id = ANY(${opts.searchUserIds}::uuid[])`);
    }
    if (opts.cursor) {
      conditions.push(Prisma.sql`(
        CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        joined_at, user_id
      ) < (
        ${opts.cursor.rank},
        ${opts.cursor.joinedAt}::timestamptz,
        ${opts.cursor.userId}::uuid
      )`);
    }
    return client.$queryRaw<Array<{ userId: string; role: string; joinedAt: Date }>>(Prisma.sql`
      SELECT user_id AS "userId", role, joined_at AS "joinedAt"
      FROM conversation_members
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at, user_id
      LIMIT ${opts.limit + 1}
    `);
  }
}
