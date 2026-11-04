import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/** Связь письма с письмом (#461, Р1): вид и вторая сторона. */
export interface LetterRelationLink {
  letterId: string;
  relatedLetterId: string;
  kind: string;
}

/**
 * Связи писем (#461, Р1/Р1а; таблица `letter_relations`): единственная точка
 * доступа модуля к строкам связей — блокировка пары писем, поиск/вставка/
 * замена/снятие, родители и дети для дерева и проверки циклов. Связи живут
 * в транзакциях вызывающего сервиса (patterns.md).
 */
@Injectable()
export class LetterRelationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Блокировка обеих строк письма на транзакцию связи: порядок по id —
   *  deadlock-free (встречные связи A→B и B→A сериализуются). */
  async lockLetters(tx: TransactionClient, ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)].sort();
    if (unique.length === 0) return;
    const list = Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`));
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM letters WHERE id IN (${list}) ORDER BY id FOR UPDATE`,
    );
  }

  /** Связь письма заданного вида (в транзакции — после блокировки). */
  relationOf(
    tx: TransactionClient,
    letterId: string,
    kind: 'reply_to' | 'nested_in',
  ): Promise<{ id: string; relatedLetterId: string } | null> {
    return tx.letterRelation.findFirst({
      where: { letterId, kind },
      select: { id: true, relatedLetterId: true },
    });
  }

  /** Связь по id в пределах письма (снятие): чужая строка не находится. */
  relationById(
    tx: TransactionClient,
    letterId: string,
    relationId: string,
  ): Promise<{ id: string; relatedLetterId: string; kind: string } | null> {
    return tx.letterRelation.findFirst({
      where: { id: relationId, letterId },
      select: { id: true, relatedLetterId: true, kind: true },
    });
  }

  async linkRelation(
    tx: TransactionClient,
    data: {
      letterId: string;
      relatedLetterId: string;
      kind: 'reply_to' | 'nested_in';
      source: 'auto' | 'manual';
    },
  ): Promise<void> {
    await tx.letterRelation.create({ data });
  }

  /** Замена цели существующей связи (Р1а): строка та же, история — replaced. */
  async replaceRelation(
    tx: TransactionClient,
    relationId: string,
    relatedLetterId: string,
  ): Promise<void> {
    await tx.letterRelation.update({
      where: { id: relationId },
      data: { relatedLetterId, source: 'manual' },
    });
  }

  async unlinkRelation(tx: TransactionClient, relationId: string): Promise<void> {
    await tx.letterRelation.delete({ where: { id: relationId } });
  }

  /** Родители писем по обоим видам (подъём дерева и проверка циклов). */
  async parentLinks(
    letterIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<LetterRelationLink[]> {
    if (letterIds.length === 0) return [];
    return (tx ?? this.prisma).letterRelation.findMany({
      where: { letterId: { in: [...letterIds] } },
      select: { letterId: true, relatedLetterId: true, kind: true },
    });
  }

  /** Дети писем по обоим видам (DFS дерева): связь + письмо-ребёнок. */
  async childLinks(letterIds: readonly string[]): Promise<
    {
      id: string;
      letterId: string;
      relatedLetterId: string;
      kind: string;
    }[]
  > {
    if (letterIds.length === 0) return [];
    return this.prisma.letterRelation.findMany({
      where: { relatedLetterId: { in: [...letterIds] } },
      select: { id: true, letterId: true, relatedLetterId: true, kind: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
