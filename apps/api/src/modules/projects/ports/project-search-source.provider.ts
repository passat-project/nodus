import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type {
  SearchScanCursor,
  SearchScanPage,
  SearchSourceDocument,
  SearchSourceProvider,
} from '../../../core/ports/search-source.port.js';
import { ProjectReaderProvider } from './project-reader.provider.js';

const projectSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Провайдер источника «проект» (#952, Р5): имя + описание + шифр. Шифр —
 * атрибут «Шифр» (Р9 #631), его эффективное значение считает тот же путь,
 * что журнал (`ProjectReaderProvider.refs` → формулы типа) — колонка `code`
 * заморожена и не читается (F4).
 *
 * Архивный проект — tombstone: поиск не ведёт в замороженную карточку.
 */
@Injectable()
export class ProjectSearchSourceProvider implements SearchSourceProvider {
  readonly searchSourceType = 'project' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: ProjectReaderProvider,
  ) {}

  async load(ids: string[]): Promise<SearchSourceDocument[]> {
    const rows = await this.prisma.project.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: projectSelect,
    });
    return this.toDocuments(rows);
  }

  async scan(after: SearchScanCursor | null, limit: number): Promise<SearchScanPage> {
    const rows = await this.prisma.project.findMany({
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
      select: projectSelect,
    });
    const last = rows[rows.length - 1];
    return {
      rows: await this.toDocuments(rows),
      next: rows.length === limit && last ? { sourceUpdatedAt: last.updatedAt, id: last.id } : null,
    };
  }

  private async toDocuments(
    rows: ReadonlyArray<{
      id: string;
      name: string;
      description: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ): Promise<SearchSourceDocument[]> {
    const codes = new Map(
      (await this.reader.refs(rows.map((row) => row.id))).map((r) => [r.id, r.code]),
    );
    return rows.map((row) =>
      row.status === 'archived'
        ? { type: 'project', id: row.id, deleted: true, sourceUpdatedAt: row.updatedAt }
        : {
            type: 'project',
            id: row.id,
            title: row.name,
            body: row.description,
            keywords: codes.get(row.id) ?? '',
            projectId: row.id,
            conversationId: null,
            counterpartyId: null,
            authorId: null,
            participantIds: [],
            confidential: false,
            registered: true,
            aclKind: 'project',
            payload: { code: codes.get(row.id) ?? null, status: row.status },
            sourceCreatedAt: row.createdAt,
            sourceUpdatedAt: row.updatedAt,
          },
    );
  }
}
