import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { MESSAGE_COLS, type ClaimedAttachmentRow, type MessageRow } from './message-row.js';

/**
 * Путь записи сообщений (отправка/пересылка): порядок (seq через лок строки
 * беседы), идемпотентная вставка (ON CONFLICT по автору+client_message_id —
 * crash-окно Redis-реплея закрывает БД), привязка/копии вложений, лимит
 * важных. Все записи сообщений идут ПОСЛЕ UPDATE conversations SET last_seq
 * (лок строки) → транзакции одной беседы сериализуются, порядок seq ==
 * порядку коммита. Выделен из MessagesRepository (I5: файл агрегата
 * перерос 500 строк; чтение/жизненный цикл/прочитанность — соседние файлы).
 */
@Injectable()
export class MessagesWriteRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: TransactionClient): PrismaService | TransactionClient {
    return tx ?? this.prisma;
  }

  /**
   * Выделяет `count` подряд идущих seq: инкремент last_seq с возвратом.
   * Лок строки беседы держится до конца транзакции — все вставки сообщений
   * беседы сериализуются (глобальный bigserial так не может: значение
   * выдаётся до коммита, конкурентные транзакции коммитятся вне порядка seq,
   * курсор «после N» теряет сообщения — см. комментарий модели Conversation).
   * Возвращает ПЕРВЫЙ seq диапазона (конец = first + count - 1).
   */
  async allocateSeqs(
    conversationId: string,
    count: number,
    tx: TransactionClient,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<{ last_seq: bigint }[]>(Prisma.sql`
      UPDATE conversations
      SET last_seq = last_seq + ${count}::bigint, updated_at = now()
      WHERE id = ${conversationId}::uuid
      RETURNING last_seq
    `);
    if (!rows[0]) throw new Error(`allocateSeqs: conversation ${conversationId} not found`);
    return rows[0].last_seq - BigInt(count) + 1n;
  }

  /** Активность беседы — только корневые сообщения (мок: тред не lastMessage). */
  async touchLastMessageAt(conversationId: string, tx: TransactionClient): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      UPDATE conversations
      SET last_message_at = GREATEST(last_message_at, now()), updated_at = now()
      WHERE id = ${conversationId}::uuid
    `);
  }

  /**
   * Идемпотентная вставка: ON CONFLICT (author_id, client_message_id)
   * DO NOTHING; пустой RETURNING = повтор (replay) → вызывающий делает
   * findExisting. Привязка вложений и побочные эффекты — на вызывающем.
   */
  async insertMessage(
    input: {
      id: string;
      conversationId: string;
      seq: bigint;
      authorId: string;
      clientMessageId: string;
      text: string;
      replyToId: string | null;
      replySnapshot: object | null;
      threadRootId: string | null;
      fwd: {
        conversationId: string;
        messageId: string;
        authorId: string;
        threadRootId: string | null;
      } | null;
      urgent: boolean;
      mentionedUserIds: string[];
      /** Накопительное множество (#239): ТОКЕНЫ без разворота «Все» —
       *  прямой тэг ≠ broadcast; на отправке = токенам текста. */
      everMentionedUserIds: string[];
      createdAt: Date;
      /** Вид сообщения (#380): обычная отправка — 'text'. */
      kind?: string;
      /** Данные блока (task_transition) — JSONB payload. */
      payload?: object | null;
    },
    tx: TransactionClient,
  ): Promise<MessageRow | null> {
    const snapshot = input.replySnapshot === null ? null : JSON.stringify(input.replySnapshot);
    const mentioned = JSON.stringify(input.mentionedUserIds);
    // ever = ТОКЕНЫ текста (#239): личный тэг и сентинел «Все», без
    // разворота — broadcast не глушит будущий первый личный тэг.
    const ever = JSON.stringify(input.everMentionedUserIds);
    const payload =
      input.payload === undefined || input.payload === null ? null : JSON.stringify(input.payload);
    const rows = await tx.$queryRaw<MessageRow[]>(Prisma.sql`
      INSERT INTO messages (
        id, conversation_id, seq, author_id, client_message_id, text,
        kind, payload,
        reply_to_id, reply_snapshot, thread_root_id,
        fwd_conversation_id, fwd_message_id, fwd_author_id, fwd_thread_root_id,
        urgent, mentioned_user_ids, ever_mentioned_user_ids,
        created_at, updated_at
      ) VALUES (
        ${input.id}::uuid, ${input.conversationId}::uuid, ${input.seq}::bigint,
        ${input.authorId}::uuid, ${input.clientMessageId}, ${input.text},
        ${input.kind ?? 'text'}, ${payload}::jsonb,
        ${input.replyToId}::uuid, ${snapshot}::jsonb, ${input.threadRootId}::uuid,
        ${input.fwd?.conversationId ?? null}::uuid, ${input.fwd?.messageId ?? null}::uuid,
        ${input.fwd?.authorId ?? null}::uuid, ${input.fwd?.threadRootId ?? null}::uuid,
        ${input.urgent}, ${mentioned}::jsonb, ${ever}::jsonb,
        ${input.createdAt}::timestamptz, ${input.createdAt}::timestamptz
      )
      ON CONFLICT (author_id, client_message_id) DO NOTHING
      RETURNING ${MESSAGE_COLS}
    `);
    return rows[0] ?? null;
  }

  /** Существующее сообщение по идемпотентной паре (replay-ветка). */
  async findExisting(
    authorId: string,
    clientMessageId: string,
    tx?: TransactionClient,
  ): Promise<MessageRow | null> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<MessageRow[]>(Prisma.sql`
      SELECT ${MESSAGE_COLS} FROM messages
      WHERE author_id = ${authorId}::uuid AND client_message_id = ${clientMessageId}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /** Существующие сообщения автора по набору идемпотентных ключей (replay
   *  пересылки: копии одного запроса делят базовый ключ с суффиксами),
   *  порядок — seq (порядок блока пересылки). */
  async findExistingByKeys(
    authorId: string,
    clientMessageIds: string[],
    tx?: TransactionClient,
  ): Promise<MessageRow[]> {
    if (clientMessageIds.length === 0) return [];
    const client = this.client(tx);
    return client.$queryRaw<MessageRow[]>(Prisma.sql`
      SELECT ${MESSAGE_COLS} FROM messages
      WHERE author_id = ${authorId}::uuid AND client_message_id = ANY(${clientMessageIds}::text[])
      ORDER BY seq ASC
    `);
  }

  /** Одноразовая привязка загруженных вложений (неизвестные молча пропускаются).
   *  Возвращает привязанные строки (порядок по sort_order) — они нужны для
   *  DTO сообщения в payload события message_sent (раунд 3).
   *  renames (#146): файл переименован в окне отправки уже после загрузки —
   *  имя применяется здесь же, ДО чтения строк, чтобы DTO и событие несли
   *  актуальное имя. UPDATE скоупится message_id: чужие/непривязанные id
   *  клиента не задеваются (схема уже требует ids из attachmentIds). */
  async claimAttachments(
    messageId: string,
    attachmentIds: string[],
    ownerId: string,
    tx: TransactionClient,
    renames: ReadonlyArray<{ id: string; name: string }> = [],
  ): Promise<ClaimedAttachmentRow[]> {
    if (attachmentIds.length === 0) return [];
    await tx.$executeRaw(Prisma.sql`
      UPDATE message_attachments ma
      SET message_id = ${messageId}::uuid, sort_order = ord.ordinal - 1
      FROM unnest(${attachmentIds}::uuid[]) WITH ORDINALITY AS ord(id, ordinal)
      WHERE ma.id = ord.id AND ma.owner_id = ${ownerId}::uuid AND ma.message_id IS NULL
    `);
    if (renames.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE message_attachments ma
        SET name = r.name
        FROM unnest(
          ${renames.map((r) => r.id)}::uuid[],
          ${renames.map((r) => r.name)}::text[]
        ) AS r(id, name)
        WHERE ma.id = r.id AND ma.message_id = ${messageId}::uuid
          AND ma.owner_id = ${ownerId}::uuid
      `);
    }
    return tx.$queryRaw<ClaimedAttachmentRow[]>(Prisma.sql`
      SELECT id, file_id AS "fileId", name, size, mime, kind, width, height,
             thumb_file_id AS "thumbFileId"
      FROM message_attachments
      WHERE message_id = ${messageId}::uuid
      ORDER BY sort_order ASC, id ASC
    `);
  }

  /**
   * Копии вложений пересылки: новые строки-метаданные с тем же file_id —
   * «по ссылке» на уровне файла (перекачки нет), у каждого сообщения своя
   * строка (FK message_id одиночный). Стикеры копируются вместе со
   * снапшотом пака (sticker_meta) — пересланный стикер рендерится дальше.
   */
  async copyAttachments(
    sourceMessageId: string,
    targetMessageId: string,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO message_attachments (
        id, message_id, file_id, owner_id, name, size, mime, kind, width, height,
        thumb_file_id, sort_order, sticker_meta
      )
      SELECT gen_random_uuid(), ${targetMessageId}::uuid, file_id, owner_id, name, size,
             mime, kind, width, height, thumb_file_id, sort_order, sticker_meta
      FROM message_attachments WHERE message_id = ${sourceMessageId}::uuid
    `);
  }

  /** Срочные сообщения автора за скользящие сутки (#100): лимит
   *  NOTIFY_URGENT_DAILY_LIMIT проверяется ДО вставки в транзакции отправки. */
  async countUrgentSentSince(
    authorId: string,
    since: Date,
    tx?: TransactionClient,
  ): Promise<number> {
    const client = this.client(tx);
    const rows = await client.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*) AS count FROM messages
      WHERE author_id = ${authorId}::uuid AND urgent AND created_at >= ${since}::timestamptz
    `);
    return Number(rows[0]?.count ?? 0);
  }

  /** Старейшая важная отправка автора за окно (#177: resetAt попапа молнии
   *  = она + 24ч — момент возврата лимита); null — отправок нет. */
  async findOldestUrgentSentSince(authorId: string, since: Date): Promise<Date | null> {
    const rows = await this.prisma.$queryRaw<{ oldest: Date | null }[]>(Prisma.sql`
      SELECT min(created_at) AS oldest FROM messages
      WHERE author_id = ${authorId}::uuid AND urgent AND created_at >= ${since}::timestamptz
    `);
    return rows[0]?.oldest ?? null;
  }

  /** Сериализация проверки лимита важных одного автора (#177, паттерн #195):
   *  count и INSERT в одной tx, но без лока два параллельных отправки на
   *  границе лимита оба проходят (TOCTOU). Advisory-лок КОНКРЕТНОГО автора —
   *  чужие отправки не ждут; держится до конца tx отправки. */
  async lockUrgentLimit(authorId: string, tx: TransactionClient): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(177, hashtext(${authorId}::text))
    `);
  }
}
