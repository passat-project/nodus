import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type {
  SearchScanCursor,
  SearchScanPage,
  SearchSourceDocument,
  SearchSourceProvider,
} from '../../../core/ports/search-source.port.js';

const messageSelect = {
  id: true,
  conversationId: true,
  seq: true,
  authorId: true,
  text: true,
  threadRootId: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  obliterated: true,
  attachments: { select: { name: true } },
} as const;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

/**
 * Провайдер источника «сообщение» (#952, Р5): текст + имена вложений (В3 —
 * файл находится в контексте сообщения). Заголовка нет: триграммы по
 * сообщениям не считаются (Р7), FTS идёт по body. Доступ — по беседе
 * (`aclKind='conversation'`), состав участников в строке не нужен.
 *
 * Удалённое/обелитерированное сообщение — tombstone; сообщение без текста и
 * без имён файлов (стикер) в проекции не живёт — нечего находить.
 */
@Injectable()
export class MessageSearchSourceProvider implements SearchSourceProvider {
  readonly searchSourceType = 'message' as const;

  constructor(private readonly prisma: PrismaService) {}

  async load(ids: string[]): Promise<SearchSourceDocument[]> {
    const rows = await this.prisma.message.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: messageSelect,
    });
    return rows.flatMap((row) => toDocuments(row));
  }

  async scan(after: SearchScanCursor | null, limit: number): Promise<SearchScanPage> {
    // Скан по `createdAt` (иммутабельно): правки приходят событиями, а
    // бэкфилл читает актуальный текст строки независимо от порядка.
    const rows = await this.prisma.message.findMany({
      where: after
        ? {
            OR: [
              { createdAt: { gt: after.sourceUpdatedAt } },
              { createdAt: after.sourceUpdatedAt, id: { gt: after.id } },
            ],
          }
        : {},
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: messageSelect,
    });
    const last = rows[rows.length - 1];
    return {
      rows: rows.flatMap((row) => toDocuments(row)),
      next: rows.length === limit && last ? { sourceUpdatedAt: last.createdAt, id: last.id } : null,
    };
  }
}

function toDocuments(row: MessageRow): SearchSourceDocument[] {
  if (row.deletedAt !== null || row.obliterated) {
    const at = row.deletedAt ?? row.editedAt ?? row.createdAt;
    return [{ type: 'message', id: row.id, deleted: true, sourceUpdatedAt: at }];
  }
  const body = [row.text, ...row.attachments.map((attachment) => attachment.name)]
    .filter(Boolean)
    .join('\n');
  if (body.trim() === '') {
    // Нечего индексировать (стикер/системный блок) — заодно снимает строку,
    // если текст был отредактирован в пустоту.
    return [
      {
        type: 'message',
        id: row.id,
        deleted: true,
        sourceUpdatedAt: row.editedAt ?? row.createdAt,
      },
    ];
  }
  return [
    {
      type: 'message',
      id: row.id,
      title: '',
      body,
      keywords: '',
      projectId: null,
      conversationId: row.conversationId,
      counterpartyId: null,
      authorId: row.authorId,
      participantIds: [],
      confidential: false,
      registered: true,
      aclKind: 'conversation',
      payload: {
        conversationId: row.conversationId,
        seq: Number(row.seq),
        threadRootId: row.threadRootId,
      },
      sourceCreatedAt: row.createdAt,
      sourceUpdatedAt: row.editedAt ?? row.createdAt,
    },
  ];
}
