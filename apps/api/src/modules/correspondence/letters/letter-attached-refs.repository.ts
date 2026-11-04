import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { letterAttachedRefSelect, type LetterAttachedRefRow } from './letter-row.js';

/** Строка «приложенных писем» на записи (№ + контрагент + дата). */
export interface LetterAttachedRefInput {
  number: string;
  counterpartyId: string;
  letterDate: Date | null;
}

/**
 * «Приложенные письма» (#461, Р3; таблица `letter_attached_refs`): реестр
 * вложенных ДОКУМЕНТОВ конверта-матрёшки — строки читаются карточкой и
 * заменяются набором целиком (регистрация/PATCH). Вложения-файлы сюда не
 * входят.
 */
@Injectable()
export class LetterAttachedRefsRepository {
  constructor(private readonly prisma: PrismaService) {}

  attachedRefs(letterId: string): Promise<LetterAttachedRefRow[]> {
    return this.prisma.letterAttachedRef.findMany({
      where: { letterId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: letterAttachedRefSelect,
    });
  }

  /** Замена набора строк целиком: строки письма — проекция конверта,
   *  правка всегда «набором». */
  async replace(
    tx: TransactionClient,
    letterId: string,
    rows: readonly LetterAttachedRefInput[],
  ): Promise<void> {
    await tx.letterAttachedRef.deleteMany({ where: { letterId } });
    if (rows.length === 0) return;
    await tx.letterAttachedRef.createMany({
      data: rows.map((row, index) => ({ ...row, letterId, sortOrder: index })),
    });
  }
}
