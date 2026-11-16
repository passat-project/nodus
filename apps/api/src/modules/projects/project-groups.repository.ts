import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ProjectGroup } from '@nodus/contracts';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

const groupSelect = { id: true, name: true } as const;
type Row = { id: string; name: string };

/**
 * Портфели — плоский список группировки проектов (ADR-0030 п.2). Папка не
 * архивируется (вердикт владельца 13.11.2026): удаление — сразу навсегда, с
 * переносом проектов в «Без портфеля».
 */
@Injectable()
export class ProjectGroupsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(row: Row): ProjectGroup {
    return { id: row.id, name: row.name };
  }

  async list(): Promise<ProjectGroup[]> {
    const rows = await this.prisma.projectGroup.findMany({
      select: groupSelect,
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((row) => this.toDto(row));
  }

  async find(id: string): Promise<ProjectGroup | null> {
    const row = await this.prisma.projectGroup.findUnique({ select: groupSelect, where: { id } });
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

  /**
   * Удалить портфель НАВСЕГДА: проекты не теряются — переходят в «Без
   * портфеля». Ссылки обнуляем явно (детерминированно, до удаления папки),
   * хотя FK `projects.portfolio_id` и так `onDelete: SetNull`; удаление папки
   * и перенос проектов — одна транзакция (частичного состояния не бывает).
   * Возвращает имя папки и число перенесённых проектов — для аудита
   * необратимого действия (имя после удаления нигде не остаётся).
   */
  async delete(
    tx: TransactionClient,
    id: string,
  ): Promise<{ name: string; projects: number } | null> {
    const group = await tx.projectGroup.findUnique({ select: { name: true }, where: { id } });
    if (!group) return null;
    const moved = await tx.project.updateMany({
      where: { portfolioId: id },
      data: { portfolioId: null },
    });
    await tx.projectGroup.deleteMany({ where: { id } });
    return { name: group.name, projects: moved.count };
  }
}
