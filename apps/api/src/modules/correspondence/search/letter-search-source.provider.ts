import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  FILE_OBJECT_READER,
  type FileObjectReader,
} from '../../../core/ports/file-object-reader.port.js';
import type {
  SearchScanCursor,
  SearchScanPage,
  SearchSourceDocument,
  SearchSourceProvider,
} from '../../../core/ports/search-source.port.js';

const letterSelect = {
  id: true,
  regNumber: true,
  subject: true,
  theirNumber: true,
  direction: true,
  counterpartyId: true,
  registrarId: true,
  addresseeId: true,
  projectId: true,
  confidential: true,
  registeredAt: true,
  receivedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  participants: { select: { userId: true } },
  attachments: { select: { fileId: true } },
  attachedRefs: { select: { number: true } },
} as const;

type LetterRow = Prisma.LetterGetPayload<{ select: typeof letterSelect }>;

/**
 * Провайдер источника «письмо» (#952, Р5/Р10): только метаданные — тела
 * письма в БД нет (оно в PDF/сканах, ответ Д3). `title` — номер + тема,
 * `body` — их номер + номера приложенных писем + имена файлов (В3: файл
 * ищется в контексте письма). Корреспондент — отдельная query-time нога по
 * `CounterpartyReader.searchIds`, имя в индексе не денормализуется.
 *
 * «Новые» (незарегистрированные) индексируются тоже — видимость решает
 * `registered` + право канцелярии. Спам (`deletedAt`) — tombstone.
 */
@Injectable()
export class LetterSearchSourceProvider implements SearchSourceProvider {
  readonly searchSourceType = 'letter' as const;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_OBJECT_READER) private readonly files: FileObjectReader,
  ) {}

  async load(ids: string[]): Promise<SearchSourceDocument[]> {
    const rows = await this.prisma.letter.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: letterSelect,
    });
    return this.toDocuments(rows);
  }

  async scan(after: SearchScanCursor | null, limit: number): Promise<SearchScanPage> {
    const rows = await this.prisma.letter.findMany({
      where: after
        ? {
            OR: [
              { updatedAt: { gt: after.sourceUpdatedAt } },
              { updatedAt: after.sourceUpdatedAt, id: { gt: after.id } },
            ],
          }
        : {},
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: letterSelect,
    });
    const last = rows[rows.length - 1];
    return {
      rows: await this.toDocuments(rows),
      next: rows.length === limit && last ? { sourceUpdatedAt: last.updatedAt, id: last.id } : null,
    };
  }

  /** Имена файлов — одним батчем на пачку (порт files, не таблица). */
  private async toDocuments(rows: readonly LetterRow[]): Promise<SearchSourceDocument[]> {
    const fileIds = [...new Set(rows.flatMap((row) => row.attachments.map((a) => a.fileId)))];
    const names = new Map<string, string>(
      (await this.files.refs(fileIds)).map((file) => [file.id, file.name]),
    );
    return rows.map((row) => this.toDocument(row, names));
  }

  private toDocument(row: LetterRow, names: ReadonlyMap<string, string>): SearchSourceDocument {
    if (row.deletedAt !== null) {
      return { type: 'letter', id: row.id, deleted: true, sourceUpdatedAt: row.deletedAt };
    }
    const fileNames = row.attachments
      .map((attachment) => names.get(attachment.fileId))
      .filter((name): name is string => Boolean(name));
    const body = [row.theirNumber, ...row.attachedRefs.map((ref) => ref.number), ...fileNames]
      .filter((part): part is string => Boolean(part))
      .join(' · ');
    return {
      type: 'letter',
      id: row.id,
      title: [row.regNumber, row.subject].filter(Boolean).join(' '),
      body,
      keywords: row.direction === 'outgoing' ? 'исходящее' : 'входящее',
      projectId: row.projectId,
      conversationId: null,
      counterpartyId: row.counterpartyId,
      authorId: row.registrarId,
      participantIds: [
        ...new Set(
          [row.addresseeId, row.registrarId, ...row.participants.map((p) => p.userId)].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ],
      confidential: row.confidential,
      registered: row.registeredAt !== null,
      aclKind: 'letter',
      payload: {
        regNumber: row.regNumber,
        counterpartyId: row.counterpartyId,
        direction: row.direction,
      },
      sourceCreatedAt: row.receivedAt,
      sourceUpdatedAt: row.updatedAt,
    };
  }
}
