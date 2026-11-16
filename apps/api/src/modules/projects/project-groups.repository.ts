import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ProjectGroup } from '@nodus/contracts';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

const groupSelect = { id: true, name: true, archivedAt: true } as const;
type Row = { id: string; name: string; archivedAt: Date | null };

/** Портфели — плоский список группировки (ADR-0030 п.2). */
@Injectable()
export class ProjectGroupsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(row: Row): ProjectGroup {
    return { id: row.id, name: row.name, archivedAt: row.archivedAt?.toISOString() ?? null };
  }

  async list(includeArchived: boolean): Promise<ProjectGroup[]> {
    const rows = await this.prisma.projectGroup.findMany({
      select: groupSelect,
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((row) => this.toDto(row));
  }

  async findActive(id: string): Promise<ProjectGroup | null> {
    const row = await this.prisma.projectGroup.findFirst({
      select: groupSelect,
      where: { id, archivedAt: null },
    });
    return row ? this.toDto(row) : null;
  }

  async create(tx: TransactionClient, name: string, creatorId: string): Promise<ProjectGroup> {
    const row = await tx.projectGroup.create({
      select: groupSelect,
      data: { id: randomUUID(), name, creatorId },
    });
    return this.toDto(row);
  }

  async rename(tx: TransactionClient, id: string, name: string): Promise<ProjectGroup | null> {
    const result = await tx.projectGroup.updateMany({ where: { id }, data: { name } });
    if (result.count === 0) return null;
    const row = await tx.projectGroup.findUnique({ select: groupSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }

  async setArchived(
    tx: TransactionClient,
    id: string,
    archived: boolean,
  ): Promise<ProjectGroup | null> {
    const result = await tx.projectGroup.updateMany({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (result.count === 0) return null;
    const row = await tx.projectGroup.findUnique({ select: groupSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }

  async activeProjectCount(id: string): Promise<number> {
    return this.prisma.project.count({ where: { portfolioId: id, status: { not: 'archived' } } });
  }

  /**
   * Удалить портфель НАВСЕГДА: проекты не теряются — переходят в «Без
   * портфеля». Ссылки обнуляем явно (детерминированно, до удаления папки),
   * хотя FK `projects.portfolio_id` и так `onDelete: SetNull`; удаление папки
   * и перенос проектов — одна транзакция (частичного состояния не бывает).
   */
  async delete(tx: TransactionClient, id: string): Promise<boolean> {
    await tx.project.updateMany({ where: { portfolioId: id }, data: { portfolioId: null } });
    const result = await tx.projectGroup.deleteMany({ where: { id } });
    return result.count > 0;
  }
}
