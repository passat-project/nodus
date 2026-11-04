import { Injectable } from '@nestjs/common';
import type { LetterBox, LetterRef } from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  letterAttachmentSelect,
  letterDetailSelect,
  letterListSelect,
  type LetterAttachmentRow,
  type LetterCursor,
  type LetterDetailRow,
  type LetterListRow,
} from './letter-row.js';

/** Ось списка: «Новые» — по поступлению, остальные — по регистрации. */
export function listOrderOf(box: LetterBox | undefined): 'receivedAt' | 'registeredAt' {
  return box === 'new' ? 'receivedAt' : 'registeredAt';
}

/**
 * Единственная точка доступа к таблицам модуля (#55): `letters`,
 * `letter_attachments`, `letter_participants`, `letter_views` (лист целей
 * оправдывает > 300 строк — одна ответственность «хранилище писем»).
 * Чтения — вне транзакций, записи — в транзакции вызывающего (переход
 * движка, создание, правка).
 */
@Injectable()
export class LettersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Страница реестра keyset по (ось, id) DESC +1 строка — признак следующей. */
  list(
    where: Prisma.LetterWhereInput,
    order: 'receivedAt' | 'registeredAt',
    after: LetterCursor | undefined,
    limit: number,
  ): Promise<LetterListRow[]> {
    const cursorWhere = after
      ? {
          OR: [
            { [order]: { lt: new Date(after.at) } },
            { [order]: new Date(after.at), id: { lt: after.id } },
          ],
        }
      : {};
    return this.prisma.letter.findMany({
      where: { AND: [where, cursorWhere] },
      orderBy: [{ [order]: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: letterListSelect,
    });
  }

  findDetail(where: Prisma.LetterWhereInput): Promise<LetterDetailRow | null> {
    return this.prisma.letter.findFirst({ where, select: letterDetailSelect });
  }

  findDetailById(id: string, tx?: TransactionClient): Promise<LetterDetailRow | null> {
    return (tx ?? this.prisma).letter.findUnique({ where: { id }, select: letterDetailSelect });
  }

  /** Блокировка строки письма на транзакцию перехода (сериализация). */
  async lock(tx: TransactionClient, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM letters WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Участники пачкой по письмам страницы. */
  participantsOf(letterIds: readonly string[]): Promise<{ letterId: string; userId: string }[]> {
    if (letterIds.length === 0) return Promise.resolve([]);
    return this.prisma.letterParticipant.findMany({
      where: { letterId: { in: [...letterIds] } },
      select: { letterId: true, userId: true },
    });
  }

  /** Участники одного письма (деталь, состав чата) — по времени прихода:
   *  первый участник незарегистрированного обсуждения — его создатель. */
  participants(letterId: string): Promise<{ userId: string; role: string; createdAt: Date }[]> {
    return this.prisma.letterParticipant.findMany({
      where: { letterId },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      select: { userId: true, role: true, createdAt: true },
    });
  }

  /** Личный признак «просмотрено» (редизайн #56): вставка идемпотентна —
   *  повторное открытие не двигает время первого просмотра. */
  async markViewed(letterId: string, userId: string): Promise<void> {
    await this.prisma.letterView.createMany({
      data: [{ letterId, userId }],
      skipDuplicates: true,
    });
  }

  /** Просмотренные сотрудником письма страницы (индикатор «я не открывал»). */
  async viewedLetterIds(userId: string, letterIds: readonly string[]): Promise<Set<string>> {
    if (letterIds.length === 0) return new Set();
    const rows = await this.prisma.letterView.findMany({
      where: { userId, letterId: { in: [...letterIds] } },
      select: { letterId: true },
    });
    return new Set(rows.map((row) => row.letterId));
  }

  /** Скрепка в списке — ТОЛЬКО настоящие вложения: текст письма (body),
   *  главный документ (main), исходник (source) и inline-картинки — части
   *  письма, а не приложения (вердикт владельца 28.10). */
  async attachmentCounts(letterIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (letterIds.length === 0) return counts;
    const rows = await this.prisma.letterAttachment.groupBy({
      by: ['letterId'],
      where: {
        letterId: { in: [...letterIds] },
        role: 'attachment',
        inline: false,
      },
      _count: { _all: true },
    });
    for (const row of rows) counts.set(row.letterId, row._count._all);
    return counts;
  }

  attachments(letterId: string, tx?: TransactionClient): Promise<LetterAttachmentRow[]> {
    return (tx ?? this.prisma).letterAttachment.findMany({
      where: { letterId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: letterAttachmentSelect,
    });
  }

  // ===== «Основной документ письма» (#56): PDF-копия тела + выбор звездой =====

  /** Копия тела уже есть (проверка гонки внутри транзакции вставки). */
  hasBodyPdf(tx: TransactionClient, letterId: string): Promise<boolean> {
    return tx.letterAttachment
      .findFirst({ where: { letterId, role: 'body_pdf' }, select: { id: true } })
      .then(Boolean);
  }

  /** Вставка PDF-копии тела (роль body_pdf; частичный unique — одна на
   *  письмо, гонка постановок гасится вызывающим). */
  async addBodyPdf(
    tx: TransactionClient,
    letterId: string,
    data: { fileId: string; sortOrder: number },
  ): Promise<void> {
    await tx.letterAttachment.create({
      data: { letterId, fileId: data.fileId, role: 'body_pdf', sortOrder: data.sortOrder },
    });
  }

  /** Backfill конвертации: живые почтовые письма с телом, но без PDF-копии
   *  (приняты до конвейера или при отказавшем конвертере). */
  async bodyPdfBacklog(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM letters l
      JOIN letter_attachments body ON body.letter_id = l.id AND body.role = 'body'
      WHERE l.deleted_at IS NULL AND l.mail_parse_issue = false
        AND NOT EXISTS (
          SELECT 1 FROM letter_attachments pdf
          WHERE pdf.letter_id = l.id AND pdf.role = 'body_pdf'
        )`;
    return rows.map((row) => row.id);
  }

  /** Выбор основного документа звездой: новые роли за один раз —
   *  promoting становится main, прежний main (если был) — приложением. */
  async setMainRoles(
    tx: TransactionClient,
    letterId: string,
    changes: { promoteId?: string; demoteIds: readonly string[] },
  ): Promise<void> {
    if (changes.demoteIds.length > 0) {
      await tx.letterAttachment.updateMany({
        where: { letterId, id: { in: [...changes.demoteIds] } },
        data: { role: 'attachment' },
      });
    }
    if (changes.promoteId) {
      await tx.letterAttachment.update({
        where: { id: changes.promoteId },
        data: { role: 'main' },
      });
    }
  }

  create(tx: TransactionClient, data: Prisma.LetterUncheckedCreateInput) {
    return tx.letter.create({ data });
  }

  async update(
    tx: TransactionClient,
    id: string,
    data: Prisma.LetterUncheckedUpdateInput,
  ): Promise<void> {
    await tx.letter.update({ where: { id }, data });
  }

  /** Письма, в которых лежит файл, — видимость для контрибьютора прав
   *  файлов (#55, B5; #461 — конфиденциальность). Файл может быть приложен
   *  к нескольким письмам; состав обсуждения читается только для
   *  конфиденциальных (иначе — лишний запрос на каждый файл). */
  async visibilityByFile(fileId: string): Promise<
    {
      registeredAt: Date | null;
      confidential: boolean;
      registrarId: string | null;
      addresseeId: string | null;
      participants: string[];
    }[]
  > {
    const rows = await this.prisma.letterAttachment.findMany({
      where: { fileId },
      select: {
        letter: {
          select: {
            id: true,
            registeredAt: true,
            confidential: true,
            registrarId: true,
            addresseeId: true,
          },
        },
      },
    });
    const confidentialIds = rows
      .filter((row) => row.letter.confidential)
      .map((row) => row.letter.id);
    const participants = await this.participantsOf(confidentialIds);
    return rows.map(({ letter }) => ({
      registeredAt: letter.registeredAt,
      confidential: letter.confidential,
      registrarId: letter.registrarId,
      addresseeId: letter.addresseeId,
      participants: participants
        .filter((participant) => participant.letterId === letter.id)
        .map((participant) => participant.userId),
    }));
  }

  /** Файлы письма для удаления объектов хранилища (спам, Р12). */
  fileIds(letterId: string): Promise<string[]> {
    return this.prisma.letterAttachment
      .findMany({ where: { letterId }, select: { fileId: true } })
      .then((rows) => rows.map((row) => row.fileId));
  }

  /** Присоединение к обсуждению — идемпотентно (PK письмо+сотрудник). */
  async addParticipant(tx: TransactionClient, letterId: string, userId: string): Promise<boolean> {
    const existing = await tx.letterParticipant.findUnique({
      where: { letterId_userId: { letterId, userId } },
      select: { userId: true },
    });
    if (existing) return false;
    await tx.letterParticipant.create({ data: { letterId, userId } });
    return true;
  }

  /** Состав чата: адресат + участники (регистратор в чат не входит — В2). */
  async chatRoster(
    letterId: string,
  ): Promise<{ addresseeId: string | null; registeredAt: Date | null } | null> {
    return this.prisma.letter.findUnique({
      where: { id: letterId },
      select: { addresseeId: true, registeredAt: true },
    });
  }

  /** Ссылки на письма пачкой (чат, превью). */
  refs(ids: readonly string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.letter.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, regNumber: true, subject: true },
    });
  }

  // ===== Связи «ответ на» (#56, Р5; таблица letter_relations) =====

  /** Связи «ответ на» страницы списков: бейдж очереди «Новые». */
  async replyTos(letterIds: readonly string[]): Promise<Map<string, LetterRef>> {
    if (letterIds.length === 0) return new Map();
    const rows = await this.prisma.letterRelation.findMany({
      where: { letterId: { in: [...letterIds] }, kind: 'reply_to' },
      select: {
        letterId: true,
        relatedLetter: { select: { id: true, regNumber: true, subject: true } },
      },
    });
    return new Map(rows.map((row) => [row.letterId, row.relatedLetter]));
  }

  /** Связь «ответ на» письма или null (карточка). */
  async replyTo(letterId: string): Promise<LetterRef | null> {
    const row = await this.prisma.letterRelation.findFirst({
      where: { letterId, kind: 'reply_to' },
      select: { relatedLetter: { select: { id: true, regNumber: true, subject: true } } },
    });
    return row?.relatedLetter ?? null;
  }

  /** Вставка связи идемпотентна (частичный unique «один reply_to») — в
   *  транзакции создания/регистрации письма. true — вставили. */
  async linkReplyTo(
    tx: TransactionClient,
    letterId: string,
    relatedLetterId: string,
    source: 'auto' | 'manual',
  ): Promise<boolean> {
    const existing = await tx.letterRelation.findFirst({
      where: { letterId, kind: 'reply_to' },
      select: { id: true },
    });
    if (existing) return false;
    await tx.letterRelation.create({
      data: { letterId, relatedLetterId, kind: 'reply_to', source },
    });
    return true;
  }

  /** Цель связи по id (валидация подтверждения, Р5): живое письмо с
   *  направлением и регистрацией — в транзакции регистрации. */
  replyTargetById(tx: TransactionClient, id: string) {
    return tx.letter.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, direction: true, registeredAt: true },
    });
  }

  /** Есть ли у письма уже связь «ответ на» (в транзакции регистрации). */
  hasReplyTo(tx: TransactionClient, letterId: string): Promise<boolean> {
    return tx.letterRelation
      .findFirst({ where: { letterId, kind: 'reply_to' }, select: { id: true } })
      .then(Boolean);
  }

  /** Живые письма по Message-ID (надгробия спама исключены — авто-связь не
   *  цепляется к удалённому). Цель «ответ на» — зарегистрированное исходящее
   *  (контракт списка; security-ревью #56: подделка References не тянет
   *  связь на чужое входящее). */
  findByMailMessageIds(messageIds: readonly string[]) {
    if (messageIds.length === 0) return Promise.resolve([]);
    return this.prisma.letter.findMany({
      where: {
        mailMessageId: { in: [...messageIds] },
        deletedAt: null,
        direction: 'outgoing',
        registeredAt: { not: null },
      },
      select: { id: true, regNumber: true, subject: true, mailMessageId: true },
    });
  }

  /** Существует ли письмо с Message-ID — дедуп приёма (Р3): надгробие тоже
   *  «существует» (удалённый спам не возвращается). */
  mailMessageIdTaken(messageId: string): Promise<boolean> {
    return this.prisma.letter
      .findFirst({ where: { mailMessageId: messageId }, select: { id: true } })
      .then(Boolean);
  }

  /** Зарегистрированное исходящее по номеру «Исх-ГГГГ/N» — нечёткая
   *  подсказка «ответ на» по теме (Р5). */
  findRegisteredOutgoingByNumber(regNumber: string): Promise<LetterRef | null> {
    return this.prisma.letter.findFirst({
      where: { regNumber, direction: 'outgoing', registeredAt: { not: null }, deletedAt: null },
      select: { id: true, regNumber: true, subject: true },
    });
  }

  /** Надгробие спама (Р13): строка живёт, файлы и вложения снесены. */
  async tombstone(tx: TransactionClient, id: string): Promise<void> {
    await tx.letterAttachment.deleteMany({ where: { letterId: id } });
    await tx.letter.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Счётчики стадий (диалог публикации, мета списка). */
  async countByStages(stageIds: readonly string[]): Promise<Record<string, number>> {
    if (stageIds.length === 0) return {};
    const rows = await this.prisma.letter.groupBy({
      by: ['stageId'],
      where: { stageId: { in: [...stageIds] }, deletedAt: null },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.stageId] = row._count._all;
    return counts;
  }

  /** Пачка писем стадии для фонового переноса (keyset по id). */
  byStagePage(stageId: string, afterId: string | null, limit: number) {
    return this.prisma.letter.findMany({
      where: { stageId, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, workflowId: true },
    });
  }

  async moveToStage(tx: TransactionClient, id: string, stageId: string, systemState: string) {
    await tx.letter.update({
      where: { id },
      data: { stageId, systemState, stateChangedAt: new Date() },
    });
  }

  async restateStage(stageId: string, systemState: string): Promise<number> {
    const result = await this.prisma.letter.updateMany({
      where: { stageId, systemState: { not: systemState } },
      data: { systemState, stateChangedAt: new Date() },
    });
    return result.count;
  }

  /** Строки видимости пачкой (счётчик CRM, дерево): без файлов и атрибутов. */
  visibilityRows(letterIds: readonly string[]): Promise<
    {
      id: string;
      registeredAt: Date | null;
      confidential: boolean;
      registrarId: string | null;
      addresseeId: string | null;
    }[]
  > {
    if (letterIds.length === 0) return Promise.resolve([]);
    return this.prisma.letter.findMany({
      where: { id: { in: [...letterIds] } },
      select: {
        id: true,
        registeredAt: true,
        confidential: true,
        registrarId: true,
        addresseeId: true,
      },
    });
  }

  /** Узлы дерева пачкой: реквизиты строки и состояние стадии. */
  nodesByIds(letterIds: readonly string[]): Promise<
    {
      id: string;
      regNumber: string | null;
      theirNumber: string | null;
      subject: string | null;
      direction: string;
      systemState: string;
      confidential: boolean;
      registeredAt: Date | null;
      registrarId: string | null;
      addresseeId: string | null;
      deletedAt: Date | null;
    }[]
  > {
    if (letterIds.length === 0) return Promise.resolve([]);
    return this.prisma.letter.findMany({
      where: { id: { in: [...letterIds] } },
      select: {
        id: true,
        regNumber: true,
        theirNumber: true,
        subject: true,
        direction: true,
        systemState: true,
        confidential: true,
        registeredAt: true,
        registrarId: true,
        addresseeId: true,
        deletedAt: true,
      },
    });
  }

  /** Уборка значений удалённого атрибута (#582): ключ убирается из
   *  `custom_fields` пачками, идемпотентно. Мягко удалённые письма тоже
   *  чистим — восстановление не должно воскрешать значение удалённого
   *  атрибута. Другие ключи не трогаются. */
  async removeCustomFieldValues(fieldId: string, batch = 500): Promise<number> {
    let removed = 0;
    for (;;) {
      const affected = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE letters SET custom_fields = custom_fields - ${fieldId}::text
        WHERE id IN (
          SELECT id FROM letters WHERE custom_fields ? ${fieldId}::text LIMIT ${batch}::int
        )
      `);
      removed += affected;
      if (affected === 0) return removed;
    }
  }
}
