import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';

import { PrismaService } from '../../../core/database/prisma.service.js';
import { safeFileName } from '../../../core/http/safe-file-name.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/** Строка вложения (сырой ряд, camelCase). */
export interface AttachmentRow {
  id: string;
  fileId: string;
  ownerId: string;
  name: string;
  size: number;
  mime: string;
  kind: string;
  width: number | null;
  height: number | null;
  /** Длительность видео, мс (#250); null — не видео/неизвестна. */
  durationMs: number | null;
  thumbFileId: string | null;
}

/**
 * Репозиторий загрузок-до-отправки (жизненный цикл message_attachments вне
 * транзакции отправки): счётчик трея композера, вставка после загрузки в
 * хранилище, отмена и ленивая уборка брошенных. Привязка к сообщению —
 * claimAttachments в messages.repository (та же транзакция, что и отправка).
 */
@Injectable()
export class AttachmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Загруженные-но-неотправленные вложения пользователя (лимит 20 — вердикт
   *  владельца 24.09; серверная сверка клиентской проверки). */
  async countUnclaimed(ownerId: string, tx?: TransactionClient): Promise<number> {
    return (tx ?? this.prisma).messageAttachment.count({
      where: { ownerId, messageId: null },
    });
  }

  /** Сериализация лимита неотправленных ОДНОГО владельца (паттерн
   *  lockUrgentLimit #177): count и INSERT в одной tx, но без лока две
   *  параллельные загрузки на границе лимита обе проходят (TOCTOU).
   *  Advisory-лок до конца tx; чужие загрузки не ждут. */
  async lockPendingLimit(ownerId: string, tx: TransactionClient): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(57, hashtext(${ownerId}::text))
    `);
  }

  /** Неотправленные старше порога — кандидаты на ленивую уборку (#57):
   *  строка + объект хранилища не должны копиться вечно. */
  async findStaleUnclaimed(
    ownerId: string,
    olderThan: Date,
  ): Promise<{ id: string; fileId: string }[]> {
    return this.prisma.messageAttachment.findMany({
      where: { ownerId, messageId: null, createdAt: { lt: olderThan } },
      select: { id: true, fileId: true },
    });
  }

  async deleteUnclaimedByIds(ownerId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.messageAttachment.deleteMany({
      where: { id: { in: ids }, ownerId, messageId: null },
    });
  }

  async insertAttachment(
    row: {
      id: string;
      fileId: string;
      ownerId: string;
      name: string;
      size: number;
      mime: string;
      kind: string;
      width: number | null;
      height: number | null;
      durationMs: number | null;
    },
    tx?: TransactionClient,
  ): Promise<AttachmentRow> {
    return (tx ?? this.prisma).messageAttachment.create({ data: row });
  }

  /** Любое вложение по id (воркер превью #150: работает и с отправленными —
   *  в отличие от findUnclaimed; null — строка удалена каскадом сообщения). */
  findAnyById(id: string): Promise<AttachmentRow | null> {
    return this.prisma.messageAttachment.findUnique({ where: { id } });
  }

  /** Беседа отправленного вложения (событие готовности превью #221):
   *  null — ещё не отправлено (DTO отправки возьмёт свежий thumbFileId сам)
   *  или сообщение уже удалено. */
  async findConversationIdOf(id: string): Promise<string | null> {
    const row = await this.prisma.messageAttachment.findUnique({
      where: { id },
      select: { message: { select: { conversationId: true } } },
    });
    return row?.message?.conversationId ?? null;
  }

  /** Беседы, где файл отправлен вложением (мост версий files → чат, #182):
   *  только отправленные (messageId ≠ null — «трей» композера аудитории не
   *  имеет); distinct — файл может лежать в нескольких беседах/сообщениях. */
  async findConversationIdsWithFile(fileId: string): Promise<string[]> {
    const rows = await this.prisma.messageAttachment.findMany({
      where: { fileId, messageId: { not: null } },
      select: { message: { select: { conversationId: true } } },
    });
    return [
      ...new Set(rows.map((row) => row.message?.conversationId).filter((id): id is string => !!id)),
    ];
  }

  /** Фиксация превью (#150): thumbFileId + авторитетные серверные габариты
   *  (перезаписывают клиентские — сервер не доверяет им после sharp).
   *  Compare-and-set по thumbFileId=null: гонка двойной генерации (#156 —
   *  jobId вытеснен из removeOnComplete) даёт false, указатель победителя
   *  не перезаписывается; проигравший дериват удаляет вызывающий. */
  async markThumbnail(
    id: string,
    data: {
      thumbFileId: string;
      width: number;
      height: number;
      /** Длительность видео (мс, #250); у изображений не передаётся. */
      durationMs?: number | null;
    },
  ): Promise<boolean> {
    const result = await this.prisma.messageAttachment.updateMany({
      where: { id, thumbFileId: null },
      data,
    });
    return result.count === 1;
  }

  /** Неотправленное вложение владельца (для отмены; null — уже отправлено/
   *  чужое/удалено — отмена best-effort). */
  async findUnclaimed(id: string, ownerId: string): Promise<AttachmentRow | null> {
    return this.prisma.messageAttachment.findFirst({
      where: { id, ownerId, messageId: null },
    });
  }

  /** Удаление неотправленного (одноразовая привязка могла успеть сработать —
   *  условие message_id IS NULL страхует от гонки с отправкой). */
  async deleteUnclaimed(id: string, ownerId: string): Promise<boolean> {
    const result = await this.prisma.messageAttachment.deleteMany({
      where: { id, ownerId, messageId: null },
    });
    return result.count > 0;
  }

  /** Синхронизация состава вложений правки (#188): убранные из списка строки
   *  открепляются (файл-объект хранилища живёт — его могут держать копии
   *  пересылки с тем же file_id, уборка брошенного — фоновая гигиена #57),
   *  новые привязываются (owner, одноразовый claim), порядок = позициям
   *  списка. Чужие/уже занятые другим сообщением id молча пропускаются
   *  (семантика отправки). */
  async syncMessageAttachments(
    messageId: string,
    attachmentIds: string[],
    ownerId: string,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM message_attachments
      WHERE message_id = ${messageId}::uuid AND NOT (id = ANY(${attachmentIds}::uuid[]))
    `);
    if (attachmentIds.length === 0) return;
    await tx.$executeRaw(Prisma.sql`
      UPDATE message_attachments ma
      SET message_id = ${messageId}::uuid, sort_order = ord.ordinal - 1
      FROM unnest(${attachmentIds}::uuid[]) WITH ORDINALITY AS ord(id, ordinal)
      WHERE ma.id = ord.id AND ma.owner_id = ${ownerId}::uuid
        AND (ma.message_id IS NULL OR ma.message_id = ${messageId}::uuid)
    `);
  }

  /** Переименование файлов правки (#188): только строки этого сообщения;
   *  идемпотентно (повтор с тем же именем — no-op). */
  async renameMessageAttachments(
    messageId: string,
    renames: Array<{ id: string; name: string }>,
    tx: TransactionClient,
  ): Promise<void> {
    if (renames.length === 0) return;
    const ids = renames.map((r) => r.id);
    const names = renames.map((r) => safeFileName(r.name));
    await tx.$executeRaw(Prisma.sql`
      UPDATE message_attachments ma
      SET name = r.name
      FROM unnest(${ids}::uuid[], ${names}::text[]) AS r(id, name)
      WHERE ma.id = r.id AND ma.message_id = ${messageId}::uuid
    `);
  }
}
