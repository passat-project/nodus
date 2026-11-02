import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_NODE_KIND_FORM,
  type NodeKind,
  type NodeKindIcon,
  type ProjectColor,
} from '@nodus/contracts';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

const kindSelect = { id: true, name: true, icon: true, color: true, archivedAt: true } as const;
type KindRow = { id: string; name: string; icon: string; color: string; archivedAt: Date | null };

export interface NodeKindPatch {
  name?: string;
  icon?: string;
  color?: string;
}

/**
 * Таблица `node_kinds` — виды уровней (ярлыки узлов структуры, #467).
 * Справочник «Автоматизации»: чтение — всем, правка — project.setup.manage
 * (гвард контроллера); удаление = архивация. Уникальность имени
 * lower(btrim(name)) — выраженный индекс в миграции, проверка здесь raw-SQL
 * (Prisma выражения не декларирует, канон projects_code_key).
 */
@Injectable()
export class NodeKindsRepository {
  constructor(private readonly prisma: PrismaService) {}

  toDto(row: KindRow): NodeKind {
    return {
      id: row.id,
      name: row.name,
      icon: row.icon as NodeKindIcon,
      color: row.color as ProjectColor,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      // #556 UI-пакет: заглушка — конфигурация вида появится в пакете 2.
      form: DEFAULT_NODE_KIND_FORM,
      capabilities: [],
    };
  }

  /** Все виды: живые по имени, архивные в конце (подсказка окна создания). */
  async list(): Promise<NodeKind[]> {
    const rows = await this.prisma.nodeKind.findMany({
      select: kindSelect,
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    return rows.map((row) => this.toDto(row));
  }

  async findById(id: string): Promise<NodeKind | null> {
    const row = await this.prisma.nodeKind.findUnique({ select: kindSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }

  async findActive(id: string): Promise<NodeKind | null> {
    const row = await this.prisma.nodeKind.findFirst({
      select: kindSelect,
      where: { id, archivedAt: null },
    });
    return row ? this.toDto(row) : null;
  }

  /** Живые виды по id (валидация подсказки типа проекта). */
  async activeByIds(ids: readonly string[]): Promise<NodeKind[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.nodeKind.findMany({
      select: kindSelect,
      where: { id: { in: [...ids] }, archivedAt: null },
    });
    return rows.map((row) => this.toDto(row));
  }

  /** Имя занято без учёта регистра и краёв (зеркало уникального индекса). */
  async nameTaken(name: string, excludeId: string | null): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM node_kinds
      WHERE lower(btrim(name)) = lower(btrim(${name}))
        AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
      LIMIT 1`;
    return rows.length > 0;
  }

  async create(
    tx: TransactionClient,
    data: { name: string; icon: string; color: string },
  ): Promise<NodeKind> {
    const row = await tx.nodeKind.create({
      select: kindSelect,
      data: { id: randomUUID(), ...data },
    });
    return this.toDto(row);
  }

  async update(tx: TransactionClient, id: string, patch: NodeKindPatch): Promise<NodeKind | null> {
    const updated = await tx.nodeKind.updateMany({ where: { id }, data: patch });
    if (updated.count === 0) return null;
    const row = await tx.nodeKind.findUnique({ select: kindSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }

  async setArchived(
    tx: TransactionClient,
    id: string,
    archived: boolean,
  ): Promise<NodeKind | null> {
    const updated = await tx.nodeKind.updateMany({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (updated.count === 0) return null;
    const row = await tx.nodeKind.findUnique({ select: kindSelect, where: { id } });
    return row ? this.toDto(row) : null;
  }
}
