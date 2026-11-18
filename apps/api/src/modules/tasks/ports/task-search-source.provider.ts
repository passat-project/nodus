import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type {
  SearchScanCursor,
  SearchScanPage,
  SearchSourceDocument,
  SearchSourceProvider,
} from '../../../core/ports/search-source.port.js';

const taskSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  projectId: true,
  creatorId: true,
  assigneeId: true,
  deadline: true,
  confidential: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  participants: { select: { userId: true } },
} as const;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

/**
 * Провайдер источника «задача» (#952, Р5): модуль tasks — владелец данных,
 * поиск читает только эту строку проекции. Семантика полей — Р1:
 * автор — постановщик, участники — постановщик + ответственный + все роли
 * (наблюдатели и соисполнители) + сбор отметок не нужен (это видимость
 * решающего, а не участие).
 *
 * Мягко удалённая задача — tombstone: строка индекса удаляется, карточка
 * открывается только «была видима»-плашкой вне поиска.
 */
@Injectable()
export class TaskSearchSourceProvider implements SearchSourceProvider {
  readonly searchSourceType = 'task' as const;

  constructor(private readonly prisma: PrismaService) {}

  async load(ids: string[]): Promise<SearchSourceDocument[]> {
    const rows = await this.prisma.task.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: taskSelect,
    });
    return rows.map(toDocument);
  }

  async scan(after: SearchScanCursor | null, limit: number): Promise<SearchScanPage> {
    const rows = await this.prisma.task.findMany({
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
      select: taskSelect,
    });
    const last = rows[rows.length - 1];
    return {
      rows: rows.map(toDocument),
      next: rows.length === limit && last ? { sourceUpdatedAt: last.updatedAt, id: last.id } : null,
    };
  }
}

function toDocument(row: TaskRow): SearchSourceDocument {
  if (row.deletedAt !== null) {
    return {
      type: 'task',
      id: row.id,
      deleted: true,
      sourceUpdatedAt: row.deletedAt,
    };
  }
  return {
    type: 'task',
    id: row.id,
    title: row.title,
    body: row.description,
    keywords: `ПП-${row.number}`,
    projectId: row.projectId,
    conversationId: null,
    counterpartyId: null,
    authorId: row.creatorId,
    participantIds: [
      ...new Set([row.creatorId, row.assigneeId, ...row.participants.map((p) => p.userId)]),
    ],
    confidential: row.confidential,
    registered: true,
    aclKind: 'task',
    payload: {
      number: row.number,
      deadline: row.deadline?.toISOString() ?? null,
      projectId: row.projectId,
    },
    sourceCreatedAt: row.createdAt,
    sourceUpdatedAt: row.updatedAt,
  };
}
