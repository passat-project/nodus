import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  ListNotificationsQuery,
  Notification,
  NotificationDelivery,
  NotificationFilter,
  NotificationSettings,
} from '@nodus/contracts';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import { CHAT_MESSAGE_LIVENESS, type ChatMessageLiveness } from '../chat/message-liveness.port.js';
import type { UserRef } from '@nodus/contracts';

interface NotificationRow {
  id: string;
  seq: bigint;
  user_id: string;
  priority: string;
  kind: string;
  source_type: string;
  source_id: string;
  source_seq: bigint;
  actor_id: string | null;
  preview: string | null;
  urgent_text: string | null;
  conversation_id: string | null;
  conversation_title: string | null;
  message_id: string | null;
  thread_root_id: string | null;
  created_at: Date;
  read_at: Date | null;
  ack_at: Date | null;
  repeats_stopped_at: Date | null;
}

/** Вход создания журнала (id/uuid генерирует сервис; seq/времена — БД). */
export type NotificationInsert = Omit<
  NotificationRow,
  'seq' | 'created_at' | 'read_at' | 'ack_at' | 'repeats_stopped_at'
> & { event_id: string };

/** Превью строки ленты: обрезаем текст сообщения на границе слова. */
export const PREVIEW_MAX = 160;

/** Дефолты DND, пока у пользователя нет строки настроек (зеркало DEFAULT колонок). */
const DEFAULT_SETTINGS: NotificationSettings = {
  dndEnabled: false,
  dndStart: '22:00',
  dndEnd: '08:00',
};

/** Размер батча авто-архивации низкого (строк за один UPDATE). */
const ARCHIVE_BATCH = 1_000;

// >300 строк — обоснование (I5): единая точка SQL журнала (список/сводка/гашения/
// стопы/ознакомления/доставки/настройки) — расщепление по таблицам разорвёт
// инварианты гашения (read_at vs repeats_stopped_at) по файлам без выигрыша.

const NOTIFICATION_COLS = Prisma.sql`
  id, seq, user_id AS "user_id", priority, kind,
  source_type AS "source_type", source_id AS "source_id", source_seq AS "source_seq",
  actor_id AS "actor_id", preview, urgent_text AS "urgent_text",
  conversation_id AS "conversation_id", conversation_title AS "conversation_title",
  message_id AS "message_id", thread_root_id AS "thread_root_id",
  created_at AS "created_at", read_at AS "read_at", ack_at AS "ack_at",
  repeats_stopped_at AS "repeats_stopped_at"
`;

function filterWhere(userId: string, filter: NotificationFilter): Prisma.Sql {
  const base = Prisma.sql`user_id = ${userId}::uuid`;
  switch (filter) {
    case 'attention':
      return Prisma.sql`${base} AND read_at IS NULL AND priority <> 'low'`;
    case 'unread':
      return Prisma.sql`${base} AND read_at IS NULL`;
    case 'mentions':
      return Prisma.sql`${base} AND read_at IS NULL AND kind = 'chat.mention'`;
    case 'low':
      return Prisma.sql`${base} AND read_at IS NULL AND priority = 'low'`;
    case 'all':
    default:
      return base;
  }
}

/**
 * Единственная точка доступа модуля к таблицам журнала (patterns.md):
 * notifications + notification_deliveries. Гидратация actor — read-порт
 * профиля (ADR-0012). Сортировка детерминирована: seq DESC (id — тайбрейк
 * не нужен: seq unique).
 */
@Injectable()
export class NotificationsRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CHAT_MESSAGE_LIVENESS) private readonly messageLiveness: ChatMessageLiveness,
    @Inject(USER_PROFILE_READER) private readonly userProfiles: UserProfileReader,
  ) {}

  /** #267: строки об удалённых сообщениях не отдаются вовсе — страховка от
   *  гонки переупорядочивания outbox (message_sent обработан после
   *  message_deleted → строка создана пост-чистки) и будущих регрессий;
   *  чистку самих строк делает подписчик chat.message_deleted. Живость —
   *  read-порт чата (ADR-0012), схема messages не покидает владельца. */
  private get messageAliveGuard(): Prisma.Sql {
    return this.messageLiveness.messageAliveGuard(Prisma.sql`notifications.message_id`);
  }

  /** Страница журнала (filter + поиск + дельта afterSeq; курсор по seq). */
  async list(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<{ rows: NotificationRow[]; hasMore: boolean }> {
    const conditions = [filterWhere(userId, query.filter), this.messageAliveGuard];
    if (query.afterSeq !== undefined) {
      conditions.push(Prisma.sql`seq > ${BigInt(query.afterSeq)}::bigint`);
    }
    if (query.q !== undefined && query.q.length > 0) {
      conditions.push(Prisma.sql`preview ILIKE ${'%' + query.q + '%'}`);
    }
    if (query.cursor !== undefined) {
      conditions.push(Prisma.sql`seq < ${BigInt(query.cursor)}::bigint`);
    }
    const rows = await this.prisma.$queryRaw<NotificationRow[]>(Prisma.sql`
      SELECT ${NOTIFICATION_COLS} FROM notifications
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY seq DESC
      LIMIT ${query.limit + 1}
    `);
    return { rows: rows.slice(0, query.limit), hasMore: rows.length > query.limit };
  }

  /** Сводка «число + точка» (индикация; G4-деградация — пустая сводка). */
  async summary(userId: string): Promise<{
    urgent: number;
    high: number;
    medium: number;
    low: number;
  }> {
    const rows = await this.prisma.$queryRaw<{ priority: string; count: bigint }[]>(Prisma.sql`
      SELECT priority, count(*) AS count FROM notifications
      WHERE user_id = ${userId}::uuid AND read_at IS NULL AND ${this.messageAliveGuard}
      GROUP BY priority
    `);
    const byPriority = new Map(rows.map((r) => [r.priority, Number(r.count)]));
    return {
      urgent: byPriority.get('urgent') ?? 0,
      high: byPriority.get('high') ?? 0,
      medium: byPriority.get('medium') ?? 0,
      low: byPriority.get('low') ?? 0,
    };
  }

  /** Создание журнала из события: дедуп (event_id, user_id) — уникальный
   *  индекс; возвращает ТОЛЬКО созданные строки (повтор события — пусто). */
  async createFromEvent(
    rows: NotificationInsert[],
    tx?: TransactionClient,
  ): Promise<NotificationRow[]> {
    if (rows.length === 0) return [];
    const client = tx ?? this.prisma;
    const values = rows.map(
      (r) => Prisma.sql`(
        ${r.id}::uuid, ${r.user_id}::uuid, ${r.priority}, ${r.kind},
        ${r.source_type}, ${r.source_id}::uuid, ${r.source_seq}::bigint,
        ${r.actor_id}::uuid, ${r.preview}, ${r.urgent_text},
        ${r.conversation_id}::uuid, ${r.conversation_title}, ${r.message_id}::uuid,
        ${r.thread_root_id}::uuid, ${r.event_id}::uuid
      )`,
    );
    return client.$queryRaw<NotificationRow[]>(Prisma.sql`
      INSERT INTO notifications (
        id, user_id, priority, kind, source_type, source_id, source_seq,
        actor_id, preview, urgent_text, conversation_id,
        conversation_title, message_id, thread_root_id, event_id
      ) VALUES ${Prisma.join(values)}
      ON CONFLICT (event_id, user_id) DO NOTHING
      RETURNING ${NOTIFICATION_COLS}
    `);
  }

  /** Своё уведомление по id (RBAC: чужое = не найдено, G3). */
  async findById(
    userId: string,
    id: string,
    tx?: TransactionClient,
  ): Promise<NotificationRow | null> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<NotificationRow[]>(Prisma.sql`
      SELECT ${NOTIFICATION_COLS} FROM notifications
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    `);
    return rows[0] ?? null;
  }

  /** Прочитать одно (E3: клик по строке = автопрочтение), любое яруса —
   *  ack-механики больше нет (ревизия модели 05.10), важное гасится
   *  прочтением как обычное. changed=false — уже было прочитано (повтор
   *  чтения прочитанного эмитить не нужно). */
  async readOne(
    userId: string,
    id: string,
    tx?: TransactionClient,
  ): Promise<{ row: NotificationRow; changed: boolean } | null> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<NotificationRow[]>(Prisma.sql`
      UPDATE notifications SET read_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        AND read_at IS NULL
      RETURNING ${NOTIFICATION_COLS}
    `);
    if (rows[0]) return { row: rows[0], changed: true };
    const existing = await this.findById(userId, id, tx);
    return existing ? { row: existing, changed: false } : null;
  }

  /** Гашение по источнику (вход в чат) до watermark — ВСЕ ярусы, включая
   *  важное (прочитал = повторы этому получателю остановлены, #177
   *  ревизия 05.10). */
  async markReadBySource(
    userId: string,
    sourceId: string,
    upToSeq: number,
    tx?: TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    return client.$executeRaw(Prisma.sql`
      UPDATE notifications SET read_at = now()
      WHERE user_id = ${userId}::uuid AND source_id = ${sourceId}::uuid
        AND source_seq <= ${BigInt(upToSeq)}::bigint AND read_at IS NULL
    `);
  }

  /** Чистка журнала по удалённому сообщению (#267): строки об удалённом не
   *  имеют ценности (текст исчез) — уходят у всех пользователей в любом
   *  состоянии (read/unread; все kind с этим message_id, включая правки);
   *  возвращает user_id затронутых строк (с повторами — дедуп в сервисе). */
  async deleteByMessage(messageId: string, tx?: TransactionClient): Promise<string[]> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<{ user_id: string }[]>(Prisma.sql`
      DELETE FROM notifications WHERE message_id = ${messageId}::uuid
      RETURNING user_id
    `);
    return rows.map((r) => r.user_id);
  }

  /** Прочтение всех уведомлений сущности у пользователя (#252). */
  async readByEntity(
    userId: string,
    sourceType: string,
    sourceId: string,
    tx?: TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    return client.$executeRaw(Prisma.sql`
      UPDATE notifications SET read_at = now()
      WHERE user_id = ${userId}::uuid AND source_type = ${sourceType}
        AND source_id = ${sourceId}::uuid AND read_at IS NULL
    `);
  }

  /** Чистка журнала по удалённому источнику-сущности (задача, #252): у
   *  удалённой задачи открыть нечего — строки удаляются у всех получателей
   *  (канон чистки удалённых сообщений #267). */
  async deleteBySource(
    sourceType: string,
    sourceId: string,
    tx?: TransactionClient,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<{ user_id: string }[]>(Prisma.sql`
      DELETE FROM notifications
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}::uuid
      RETURNING user_id
    `);
    return rows.map((r) => r.user_id);
  }

  /** Чистка журнала сущности у КОНКРЕТНЫХ пользователей (#311): снятый с
   *  задачи больше не участник — её уведомления у него уходят (ссылка вела
   *  бы в «не найдено»). Возвращает user_id затронутых строк. */
  async deleteBySourceForUsers(
    sourceType: string,
    sourceId: string,
    userIds: string[],
    tx?: TransactionClient,
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<{ user_id: string }[]>(Prisma.sql`
      DELETE FROM notifications
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}::uuid
        AND user_id = ANY(${userIds}::uuid[])
      RETURNING user_id
    `);
    return rows.map((r) => r.user_id);
  }

  /** Стоп повторов важного (прочтение/ответ/реакция — «увидел где угодно»,
   *  C2/C3; ack-механика выпилена, ревизия модели 05.10).
   *
   *  #770: прочтение по беседе ограничено watermark'ом `source_seq <= upToSeq`
   *  — квитанция о СТАРЫХ видимых сообщениях не должна гасить повторы более
   *  нового важного, которое пользователь ещё не видел (логика та же, что у
   *  markReadBySource). Ответ автора и стоп по реакции идут без границы. */
  async stopRepeats(
    userId: string,
    where: { messageId?: string; conversationId?: string; upToSeq?: number },
    tx?: TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const scope =
      where.messageId !== undefined
        ? Prisma.sql`message_id = ${where.messageId}::uuid`
        : where.upToSeq !== undefined
          ? Prisma.sql`source_id = ${where.conversationId}::uuid AND source_seq <= ${BigInt(where.upToSeq)}::bigint`
          : Prisma.sql`source_id = ${where.conversationId}::uuid`;
    return client.$executeRaw(Prisma.sql`
      UPDATE notifications SET repeats_stopped_at = now()
      WHERE user_id = ${userId}::uuid AND priority = 'urgent' AND ${scope}
        AND repeats_stopped_at IS NULL
    `);
  }

  /** Настройки пользователя (одна строка; null — дефолты). */
  async readSettings(userId: string): Promise<NotificationSettings | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ dnd_enabled: boolean; dnd_start: string; dnd_end: string }>
    >(Prisma.sql`
      SELECT dnd_enabled, dnd_start, dnd_end FROM notification_settings
      WHERE user_id = ${userId}::uuid
    `);
    const row = rows[0];
    if (!row) return null;
    return { dndEnabled: row.dnd_enabled, dndStart: row.dnd_start, dndEnd: row.dnd_end };
  }

  /** Upsert настроек — частичный патч ОДНИМ оператором: поле вне патча (NULL)
   *  берётся из строки (COALESCE с текущим значением) или из дефолта при
   *  вставке. ON CONFLICT DO UPDATE атомарен под row-lock — параллельные
   *  патчи разных полей (две вкладки) не затирают друг друга (раньше
   *  read-modify-write терял обновление). Возвращает итоговую строку. */
  async upsertSettings(
    userId: string,
    patch: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> {
    const enabled = patch.dndEnabled ?? null;
    const start = patch.dndStart ?? null;
    const end = patch.dndEnd ?? null;
    const rows = await this.prisma.$queryRaw<
      Array<{ dnd_enabled: boolean; dnd_start: string; dnd_end: string }>
    >(Prisma.sql`
      INSERT INTO notification_settings (user_id, dnd_enabled, dnd_start, dnd_end)
      VALUES (
        ${userId}::uuid,
        COALESCE(${enabled}::boolean, ${DEFAULT_SETTINGS.dndEnabled}),
        COALESCE(${start}::text, ${DEFAULT_SETTINGS.dndStart}),
        COALESCE(${end}::text, ${DEFAULT_SETTINGS.dndEnd})
      )
      ON CONFLICT (user_id) DO UPDATE SET
        dnd_enabled = COALESCE(${enabled}::boolean, notification_settings.dnd_enabled),
        dnd_start = COALESCE(${start}::text, notification_settings.dnd_start),
        dnd_end = COALESCE(${end}::text, notification_settings.dnd_end)
      RETURNING dnd_enabled, dnd_start, dnd_end
    `);
    const row = rows[0]!; // INSERT … ON CONFLICT DO UPDATE всегда возвращает строку
    return { dndEnabled: row.dnd_enabled, dndStart: row.dnd_start, dndEnd: row.dnd_end };
  }

  /** Запись доставки по каналу (журнал доставок, C11/D6). */
  async recordDelivery(
    notificationId: string,
    channel: 'ws' | 'repeat',
    attempt: number,
    tx?: TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.$executeRaw(Prisma.sql`
      INSERT INTO notification_deliveries (id, notification_id, channel, attempt)
      VALUES (gen_random_uuid(), ${notificationId}::uuid, ${channel}, ${attempt})
    `);
  }

  /** Журнал доставок уведомления (D6: когда и каким каналом). */
  async deliveries(notificationId: string): Promise<NotificationDelivery[]> {
    const rows = await this.prisma.$queryRaw<
      {
        channel: string;
        attempt: number;
        delivered_at: Date;
      }[]
    >(Prisma.sql`
      SELECT channel, attempt, delivered_at FROM notification_deliveries
      WHERE notification_id = ${notificationId}::uuid
      ORDER BY delivered_at ASC
    `);
    return rows.map((r) => ({
      channel: r.channel as NotificationDelivery['channel'],
      attempt: r.attempt,
      deliveredAt: r.delivered_at.toISOString(),
    }));
  }

  /** Авто-архивация низкого (анти-свалка): старше N дней — read, журнал жив.
   *  Батчами по ARCHIVE_BATCH (CTE с LIMIT, цикл до неполного батча):
   *  единый UPDATE по всем пользователям держал бы row-lock-и тысяч строк
   *  одной долгой транзакцией и блокировал бы гашения/чтения журнала.
   *  SKIP LOCKED — строку, которую прямо сейчас гасит пользователь, не ждём
   *  (заберёт следующий проход). Граница возраста фиксирована на весь проход. */
  async archiveStaleLow(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    let total = 0;
    for (;;) {
      const archived = await this.prisma.$executeRaw(Prisma.sql`
        WITH batch AS (
          SELECT id FROM notifications
          WHERE priority = 'low' AND read_at IS NULL AND created_at < ${cutoff}
          LIMIT ${ARCHIVE_BATCH}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE notifications SET read_at = now()
        FROM batch WHERE notifications.id = batch.id
      `);
      total += archived;
      if (archived < ARCHIVE_BATCH) return total;
    }
  }

  /** DTO строки журнала: гидратация actor батчем (ADR-0012). */
  async toDtos(rows: NotificationRow[]): Promise<Notification[]> {
    const actorIds = [...new Set(rows.flatMap((r) => (r.actor_id ? [r.actor_id] : [])))];
    const refs = new Map<string, UserRef>();
    for (const ref of await this.userProfiles.findRefs(actorIds)) refs.set(ref.id, ref);
    return rows.map((row) => ({
      id: row.id,
      seq: Number(row.seq),
      priority: row.priority as Notification['priority'],
      kind: row.kind as Notification['kind'],
      sourceType: row.source_type as Notification['sourceType'],
      sourceId: row.source_id,
      actor: row.actor_id ? (refs.get(row.actor_id) ?? null) : null,
      preview: row.preview,
      urgentText: row.urgent_text,
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      messageId: row.message_id,
      threadRootId: row.thread_root_id,
      createdAt: row.created_at.toISOString(),
      readAt: row.read_at?.toISOString() ?? null,
      ackAt: row.ack_at?.toISOString() ?? null,
    }));
  }

  /** Строка для повтора/воркера (сырая). */
  async findRaw(id: string): Promise<NotificationRow | null> {
    const rows = await this.prisma.$queryRaw<NotificationRow[]>(Prisma.sql`
      SELECT ${NOTIFICATION_COLS} FROM notifications WHERE id = ${id}::uuid
    `);
    return rows[0] ?? null;
  }

  /** Потолок повторов: пометить стоп (C4). */
  async markRepeatsStopped(id: string, tx?: TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.$executeRaw(Prisma.sql`
      UPDATE notifications SET repeats_stopped_at = now()
      WHERE id = ${id}::uuid AND repeats_stopped_at IS NULL
    `);
  }
}
