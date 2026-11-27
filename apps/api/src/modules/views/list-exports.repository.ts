import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Хранилище статусов выгрузок CSV (#435): строки `list_exports`. Права
 * (читает только автор) и запуск — сервис; репозиторий — CRUD.
 */
@Injectable()
export class ListExportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    id: string;
    entity: string;
    scope: object;
    filter: unknown[];
    sort: unknown[];
    columns: unknown[];
    /** Снимок прав автора: фоновая выгрузка считает видимость запроса. */
    actor: string[];
    requestedBy: string;
  }) {
    return this.prisma.listExport.create({
      data: {
        id: data.id,
        entity: data.entity,
        scopeJson: data.scope,
        filterJson: data.filter as never[],
        sortJson: data.sort as never[],
        columnsJson: data.columns as never[],
        actorJson: data.actor as never[],
        requestedBy: data.requestedBy,
        status: 'queued',
      },
    });
  }

  findById(id: string) {
    return this.prisma.listExport.findUnique({ where: { id } });
  }

  markRunning(id: string) {
    return this.prisma.listExport.update({ where: { id }, data: { status: 'running' } });
  }

  markDone(id: string, fileId: string, rowCount: number) {
    return this.prisma.listExport.update({
      where: { id },
      data: { status: 'done', fileId, rowCount, error: null },
    });
  }

  markFailed(id: string, error: string) {
    return this.prisma.listExport.update({
      where: { id },
      data: { status: 'failed', error: error.slice(0, 500) },
    });
  }
}
