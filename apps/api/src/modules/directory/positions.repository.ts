import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

/** Доступ к таблице positions (плоский справочник должностей, оба kind). */
@Injectable()
export class PositionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByKind(kind: 'management' | 'legal', includeArchived = false) {
    return this.prisma.position.findMany({
      where: { kind, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  async findById(id: string) {
    return this.prisma.position.findUnique({ where: { id } });
  }

  /** Ссылка-должность (валидация оргструктуры #441): вид и активность. */
  async findRef(
    id: string,
    tx?: TransactionClient,
  ): Promise<{ id: string; kind: 'management' | 'legal'; isActive: boolean } | null> {
    return (tx ?? this.prisma).position.findUnique({
      where: { id },
      select: { id: true, kind: true, isActive: true },
    });
  }

  async create(data: Prisma.PositionUncheckedCreateInput, tx?: TransactionClient) {
    const client = tx ?? this.prisma;
    return client.position.create({ data });
  }

  async update(id: string, data: Prisma.PositionUncheckedUpdateInput, tx?: TransactionClient) {
    const client = tx ?? this.prisma;
    return client.position.update({ where: { id }, data });
  }
}
