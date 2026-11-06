import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/database/prisma.service.js';
import type { LetterRefInfo, LetterRefReader, LetterRefViewer } from './letter-ref-reader.port.js';
import { LETTER_VISIBILITY_READER, type LetterVisibilityReader } from './letter-visibility.port.js';

/**
 * Реализация read-порта писем для ссылок атрибутов (Р5 #631): видимость —
 * существующий порт #461 (canViewLetter по кругу доступа), имя —
 * регистрационный номер и контрагент одним запросом. Надгробия спама
 * отдаются с `deleted` («запись удалена»), но видимыми не являются.
 */
@Injectable()
export class LetterRefReaderProvider implements LetterRefReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LETTER_VISIBILITY_READER) private readonly visibility: LetterVisibilityReader,
  ) {}

  async refs(letterIds: readonly string[]): Promise<LetterRefInfo[]> {
    if (letterIds.length === 0) return [];
    const rows = await this.prisma.letter.findMany({
      where: { id: { in: [...letterIds] } },
      select: { id: true, regNumber: true, counterpartyId: true, deletedAt: true },
    });
    const counterpartyIds = [
      ...new Set(rows.map((row) => row.counterpartyId).filter((id): id is string => id !== null)),
    ];
    const counterparties = await this.prisma.counterparty.findMany({
      where: { id: { in: counterpartyIds } },
      select: { id: true, shortName: true },
    });
    const nameById = new Map(counterparties.map((row) => [row.id, row.shortName]));
    return rows.map((row) => ({
      id: row.id,
      name: [
        row.regNumber ?? '—',
        row.counterpartyId ? (nameById.get(row.counterpartyId) ?? '') : '',
      ]
        .filter((part) => part !== '')
        .join(' · '),
      deleted: row.deletedAt !== null,
    }));
  }

  async visibleFor(letterId: string, viewer: LetterRefViewer): Promise<boolean> {
    return (await this.visibleForMany([letterId], viewer)).has(letterId);
  }

  async visibleForMany(
    letterIds: readonly string[],
    viewer: LetterRefViewer,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<ReadonlySet<string>> {
    if (letterIds.length === 0) return new Set();
    return this.visibility.visibleLetterIds([...new Set(letterIds)], viewer, opts);
  }
}
