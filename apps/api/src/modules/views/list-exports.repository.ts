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

  /** Активные (queued/running) заказы пользователя — лимит одновременных
   *  фоновых выгрузок на одного (анти-абраз эксплуатации). Считаются только
   *  свежие (час): джоба живёт в Redis, и при его флеше/пересоздании строка
   *  висела бы активной до TTL-уборки, занимая слот на пустом месте. */
  countActiveByUser(userId: string): Promise<number> {
    return this.prisma.listExport.count({
      where: {
        requestedBy: userId,
        status: { in: ['queued', 'running'] },
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
  }

  /** Уборка просроченных выгрузок (TTL): возвращает fileId удалённых строк —
   *  вызывающий убирает и файлы из хранилища. */
  async deleteExpired(ttlDays: number): Promise<string[]> {
    const horizon = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    const expired = await this.prisma.listExport.findMany({
      where: { createdAt: { lt: horizon } },
      select: { id: true, fileId: true },
    });
    if (expired.length === 0) return [];
    await this.prisma.listExport.deleteMany({
      where: { id: { in: expired.map((row) => row.id) } },
    });
    return expired.map((row) => row.fileId).filter((fileId): fileId is string => fileId !== null);
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
