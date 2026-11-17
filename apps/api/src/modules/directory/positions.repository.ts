import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

/** Доступ к таблице positions (плоский справочник должностей, оба kind). */
@Injectable()
export class PositionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByKind(kind: 'management' | 'legal') {
    return this.prisma.position.findMany({
      where: { kind },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  async findById(id: string, tx?: TransactionClient) {
    return (tx ?? this.prisma).position.findUnique({ where: { id } });
  }

  /** Строка должности под `FOR UPDATE` (#768): удаление и переназначение
   *  держателей не разъезжаются с параллельной правкой. Захваты — в порядке id
   *  (пара «источник → цель»), чтобы встречные переназначения не дали дедлок. */
  async lockForUpdate(id: string, tx: TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM positions WHERE id = ${id}::uuid FOR UPDATE
    `);
    return rows.length === 1;
  }

  async lockMany(ids: readonly string[], tx: TransactionClient): Promise<void> {
    const sorted = [...new Set(ids)].sort();
    if (sorted.length === 0) return;
    await tx.$queryRaw`
      SELECT id FROM positions
      WHERE id IN (${Prisma.join(sorted.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id
      FOR UPDATE
    `;
  }

  /** Держатели должности — ВСЕ, включая уволенных (вердикт владельца
   *  13.11.2026: отдельного архива должностей у уволенных нет). Считаются ОБЕ
   *  колонки: штатно они разделены по виду структуры (#441), но если в базе
   *  осталась ссылка не той колонки, удаление обязано упереться в 409 — иначе
   *  FK `SetNull` молча обнулил бы поле сотрудника. */
  async countHolders(id: string, tx: TransactionClient): Promise<number> {
    return tx.user.count({
      where: { OR: [{ positionId: id }, { legalPositionId: id }] },
    });
  }

  /** Перевод ВСЕХ держателей (в том числе уволенных) на другую должность того
   *  же вида (#768): после удаления на прежнюю должность не ссылается никто. */
  async reassignHolders(
    id: string,
    targetId: string,
    kind: 'management' | 'legal',
    tx: TransactionClient,
  ): Promise<string[]> {
    const holders = await this.holderIds(id, kind, tx);
    if (holders.length === 0) return [];
    await tx.user.updateMany({
      where: { id: { in: holders } },
      data: kind === 'management' ? { positionId: targetId } : { legalPositionId: targetId },
    });
    // Список id уходит в событие: по счётчику нельзя восстановить, у кого
    // именно переписали кадровое поле (I7/I9).
    return holders;
  }

  /** Кто держит должность в своей колонке вида — до переназначения. */
  async holderIds(
    id: string,
    kind: 'management' | 'legal',
    tx: TransactionClient,
  ): Promise<string[]> {
    const rows = await tx.user.findMany({
      where: kind === 'management' ? { positionId: id } : { legalPositionId: id },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  /** Должность по названию без учёта регистра (#768): unique(name, kind) в базе
   *  регистрозависим, а для пользователя «Инженер» и «инженер» — одно название. */
  async findByName(name: string, kind: 'management' | 'legal', tx?: TransactionClient) {
    return (tx ?? this.prisma).position.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, kind },
    });
  }

  /** Ссылка-должность (валидация оргструктуры #441): вид. Существование —
   *  единственная проверка: удаление строки жёсткое (#768). */
  async findRef(
    id: string,
    tx?: TransactionClient,
  ): Promise<{ id: string; kind: 'management' | 'legal' } | null> {
    return (tx ?? this.prisma).position.findUnique({
      where: { id },
      select: { id: true, kind: true },
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

  /** Жёсткое удаление (#768): вызывается только после перевода держателей. */
  async remove(id: string, tx: TransactionClient): Promise<void> {
    await tx.position.delete({ where: { id } });
  }
}
